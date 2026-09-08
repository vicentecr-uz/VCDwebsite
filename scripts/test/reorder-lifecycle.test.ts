import assert from 'node:assert/strict';
import { createReorderController } from '../../src/scripts/sectionReorder.ts';

type FakeNode = FakeElement | FakeText;

class FakeClassList {
  values = new Set<string>();
  add(...names: string[]) { names.forEach((name) => this.values.add(name)); }
  remove(...names: string[]) { names.forEach((name) => this.values.delete(name)); }
  contains(name: string) { return this.values.has(name); }
}

class FakeStyle {
  [key: string]: string | undefined;
  removeProperty(name: string) { delete this[name]; }
  setProperty(name: string, value: string) { this[name] = value; }
  getPropertyValue(name: string) { return this[name] ?? ''; }
}

class FakeText { parentNode: FakeElement | null = null; }

class FakeElement {
  classList = new FakeClassList();
  style = new FakeStyle();
  set className(value: string) { this.classList.add(...value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.values].join(' '); }
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  attributes = new Map<string, string>();
  rect = { top: 0, left: 0, width: 120, height: 40, right: 120, bottom: 40 };
  animateCalls: KeyframeAnimationOptions[] = [];
  animateKeyframes: Keyframe[][] = [];
  get offsetHeight() { return this.rect.height; }
  append(...nodes: FakeNode[]) { nodes.forEach((node) => this.insertNode(node, this.children.length)); }
  appendChild(node: FakeNode) { this.append(node); return node; }
  before(node: FakeNode) { this.parentNode?.insertNode(node, this.parentNode.children.indexOf(this)); }
  after(node: FakeNode) { this.parentNode?.insertNode(node, this.parentNode.children.indexOf(this) + 1); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
  insertNode(node: FakeNode, index: number) {
    if (!(node instanceof FakeElement)) return;
    node.remove();
    node.parentNode = this;
    this.children.splice(index, 0, node);
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  querySelector<T extends FakeElement>(selector: string): T | null {
    const className = selector.match(/\.([\w-]+)/)?.[1];
    if (!className) return null;
    return (this.children.find((child) => child.classList.contains(className)) as T | undefined) ?? null;
  }
  getBoundingClientRect() { return this.rect; }
  closest() { return null; }
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    this.animateKeyframes.push(keyframes);
    this.animateCalls.push(options);
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  }
}

class FakeHTMLElement extends FakeElement {}

const scheduled = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let now = 0;
const timers = new Map<number, () => void>();
let nextTimer = 1;
let createdElements: FakeElement[] = [];

const flushFrame = () => {
  const next = scheduled.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!next) return false;
  scheduled.delete(next[0]);
  now += 16;
  next[1](now);
  return true;
};

const resetGlobals = (reduced = false) => {
  scheduled.clear();
  timers.clear();
  now = 0;
  createdElements = [];
  Object.assign(globalThis, {
    HTMLElement: FakeHTMLElement,
    performance: { now: () => now },
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = nextFrame++; scheduled.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => scheduled.delete(id),
    setTimeout: (callback: () => void) => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    window: { scrollY: 0, scrollX: 0, innerHeight: 800, matchMedia: () => ({ matches: reduced }) },
    document: {
      body: new FakeElement(),
      documentElement: { scrollHeight: 800 },
      createElement: () => { const element = new FakeElement(); createdElements.push(element); return element; },
    },
    getComputedStyle: () => ({ marginTop: '0px', marginBottom: '0px', top: '0px', left: '0px', transform: 'none', boxShadow: 'none', opacity: '1', getPropertyValue: () => '' }),
  });
};

const fixture = (
  moveIndicatorWithFlip = true,
  events: string[] = [],
  onSlotSync?: (indicator: FakeElement) => void,
  onIndicatorCreate?: (indicator: FakeElement) => void,
) => {
  const zone = new FakeElement();
  const items = Array.from({ length: 3 }, (_, index) => {
    const item = new FakeElement();
    item.rect = { top: index * 56, left: 0, width: 120, height: 40, right: 120, bottom: index * 56 + 40 };
    zone.append(item);
    return item;
  });
  let dragItem: FakeElement | null = null;
  const controller = createReorderController({
    getItems: () => items.filter((item) => item !== dragItem),
    getDropZone: () => zone,
    getDragItem: () => dragItem,
    classes: { indicator: 'indicator', indicatorBody: 'body', flipMoving: 'flip', lifted: 'lifted', fadeGhost: 'ghost' },
    measureInsertGaps: () => { events.push('measure'); return { top: '0px', bottom: '0px' }; },
    onSlotSync: (indicator) => { events.push('slot'); onSlotSync?.(indicator as FakeElement); },
    onIndicatorCreate: (indicator) => onIndicatorCreate?.(indicator as FakeElement),
    scrollTuning: { maxScrollSpeed: 0 },
    moveIndicatorWithFlip,
  });
  return { zone, items, controller, setDrag: (item: FakeElement | null) => { dragItem = item; } };
};

const test = async (name: string, run: () => Promise<void> | void) => {
  await run();
  console.log(`PASS: ${name}`);
};

await test('slot mutation runs before final slot metrics measurement', () => {
  resetGlobals();
  const events: string[] = [];
  const { items, controller, setDrag } = fixture(true, events);
  setDrag(items[0]);
  controller.beginLift(items[0], new FakeElement(), 10, 10, 0, { followPointer: false });
  assert.ok(events.indexOf('slot') >= 0);
  assert.ok(events.indexOf('measure') >= 0);
  assert.ok(events.indexOf('slot') < events.indexOf('measure'));
  controller.destroy();
});

await test('initial slot height is seeded before host layout sync', () => {
  resetGlobals();
  let heightAtSlotSync = '';
  let insetAtSlotSync = '';
  const { items, controller, setDrag } = fixture(true, [], (indicator) => {
    heightAtSlotSync = indicator.style['--gap-height'] ?? '';
    insetAtSlotSync = indicator.style['--dev-section-inset'] ?? '';
    void indicator.offsetHeight;
  }, (indicator) => indicator.style.setProperty('--dev-section-inset', '12px'));
  setDrag(items[0]);
  controller.beginLift(items[0], new FakeElement(), 10, 10, 0, { followPointer: false });
  assert.equal(heightAtSlotSync, '40px');
  assert.equal(insetAtSlotSync, '12px');
  controller.destroy();
});

await test('destroy cancels lift frame and removes chrome/styles', () => {
  resetGlobals();
  const { zone, items, controller, setDrag } = fixture();
  setDrag(items[0]);
  controller.beginLift(items[0], new FakeElement(), 10, 10, 0);
  controller.destroy();
  assert.equal(scheduled.size, 0);
  assert.equal(zone.children.length, 3);
  assert.equal(items[0].style.position, '');
  assert.equal(controller.isActive(), false);
});

await test('destroy during drop resolves without committing placement', async () => {
  resetGlobals();
  const { zone, items, controller, setDrag } = fixture();
  setDrag(items[0]);
  controller.beginLift(items[0], new FakeElement(), 10, 10, 0, { followPointer: false });
  controller.setTargetIndex(2);
  flushFrame();
  flushFrame();
  assert.equal(controller.getState().placedIndex, 2, 'the pending drop has a different destination');
  const original = zone.children.filter((element) => !element.classList.contains('indicator'));
  const drop = controller.endDrop();
  controller.destroy();
  await drop;
  assert.deepEqual(zone.children.filter((element) => !element.classList.contains('indicator')), original);
});

await test('reduced motion keeps opacity fade while suppressing scale animation', async () => {
  resetGlobals(true);
  const { items, controller, setDrag } = fixture();
  setDrag(items[0]);
  controller.beginLift(items[0], new FakeElement(), 10, 10, 0, { followPointer: false });
  now = 200;
  flushFrame();
  now = 240;
  flushFrame();
  assert.ok(controller.getState().indicatorOpacity > 0 && controller.getState().indicatorOpacity < 1);
  now = 400;
  flushFrame();
  await controller.endDrop();
  assert.equal(items[0].animateCalls.length, 0);
  const body = createdElements.find((element) => element.animateKeyframes.some((frames) =>
    frames.some((frame) => 'opacity' in frame)));
  assert.ok(body?.animateCalls.some((options) => Number(options.duration) > 0));
  assert.ok(body?.animateKeyframes.some((frames) => frames.some((frame) => frame.opacity === 0)));
});

await test('destroy cancels fade ghost schedulers', () => {
  for (const runGhostFrame of [false, true]) {
    resetGlobals();
    const { zone, items, controller, setDrag } = fixture(false);
    setDrag(items[0]);
    controller.beginLift(items[0], new FakeElement(), 10, 10, 0);
    controller.setPointer(20, 120);
    now = 500;
    for (let frame = 0; frame < 20; frame += 1) flushFrame();
    controller.setPointer(20, 10);
    flushFrame();
    assert.ok(zone.children.some((element) => element.classList.contains('ghost')));
    if (runGhostFrame) {
      flushFrame();
      assert.ok(timers.size > 0);
    }
    controller.destroy();
    assert.equal(scheduled.size, 0);
    assert.equal(timers.size, 0);
    assert.equal(zone.children.some((element) => element.classList.contains('ghost')), false);
  }
});
