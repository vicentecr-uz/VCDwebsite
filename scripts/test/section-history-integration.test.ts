import { createPageScope } from '../../src/lib/pageLifecycle';
import { expect, test } from 'bun:test';
import { sectionScrollDuration, sectionScrollTop } from '../../src/lib/sectionScroll';
import { readFileSync } from 'node:fs';
import { reorderProjectStackSpacingSeams } from '../../src/lib/projectStack';
import { createHistory } from '../../src/lib/devHistory';

const source = readFileSync(new URL('../../src/components/project/ProjectSectionNavEditor.astro', import.meta.url), 'utf8');
const start = source.indexOf('          (historyScope ?? pageHistory).push(');
const end = source.indexOf('          } });', start);
if (start < 0 || end < 0) throw new Error('Could not extract section history command');
const command = source.slice(start, end + '          } });'.length);

for (const active of [true, false]) {
  test(`production outline command restores state with section mode ${active ? 'open' : 'closed'}`, async () => {
    const pageHistory = createHistory();
    let text = 'edited';
    pageHistory.push({ label: 'Text', undo: () => { text = 'original'; }, redo: () => { text = 'edited'; } });
    const historyScope = pageHistory.scope();
    const block = { value: 'Research QA' };
    const otherBlock = { value: 'Other' };
    const calls: string[] = [];
    const env = {
      historyScope, pageHistory, block, before: { value: 'Research' }, current: { value: 'Research QA' },
      mergeKey: undefined, touched: new Map(), activeBlock: otherBlock,
      capture: (target: typeof block) => ({ ...target }),
      restore: (state: typeof block) => { block.value = state.value; },
      isActive: () => active, liveBlock: () => block,
      CustomEvent,
      window: { dispatchEvent: (event: CustomEvent) => {
        expect(event.type).toBe('vcd:section-history-reveal');
        expect(event.detail.block).toBe(block);
        calls.push('reveal');
      } },
      syncDevSectionOutlineSidebar: () => calls.push('sidebar'),
      renderSelection: () => calls.push('selection'), stage: () => calls.push('stage'),
    };
    new Function('env', `with (env) { ${command} }`)(env);
    await historyScope.undo();
    expect(block.value).toBe('Research');
    expect(env.activeBlock).toBe(active ? block : otherBlock);
    expect(env.touched.get(block)).toEqual({ value: 'Research QA' });
    expect(calls).toEqual(['sidebar', 'selection', 'stage', 'reveal']);
    await historyScope.undo();
    expect(text).toBe('edited');
    env.activeBlock = otherBlock;
    await historyScope.redo();
    expect(block.value).toBe('Research QA');
    expect(env.activeBlock).toBe(active ? block : otherBlock);
    expect(calls).toEqual(['sidebar', 'selection', 'stage', 'reveal', 'sidebar', 'selection', 'stage', 'reveal']);
    await pageHistory.undo();
    await pageHistory.undo();
    expect(text).toBe('original');
  });
}

const sidebarSource = readFileSync(new URL('../../src/components/SectionSidebarNav.astro', import.meta.url), 'utf8');
const scrollStart = sidebarSource.indexOf('    const scrollToBlock =');
const scrollEnd = sidebarSource.indexOf('    // Event delegation so Section Editor', scrollStart);
const scrollScript = new Bun.Transpiler({ loader: 'ts' }).transformSync(sidebarSource.slice(scrollStart, scrollEnd));

for (const motion of ['custom', 'native', 'reduced']) {
  test(`history reveal uses ${motion} section scrolling and replaces an earlier navigation`, () => {
    const handlers = new Map<string, Function>();
    const frames = new Map<number, Function>();
    const timers = new Map<number, Function>();
    const scrolls: number[] = [];
    const links: string[] = [];
    let nextId = 0;
    class Block {
      isConnected = true;
      constructor(public id: string, public top: number) {}
      getBoundingClientRect() { return { top: this.top, height: 40 }; }
    }
    const env = {
      scrollRafId: 0, scrollTimeoutId: 0, isAutoScrolling: false, manualLockUntil: 0,
      sectionScrollDuration, sectionScrollTop, clickOffsetPx: 152, clickLockMs: 700, nav: { isConnected: true }, HTMLElement: Block,
      document: { documentElement: { scrollHeight: 10000 }, addEventListener: (type: string, fn: Function) => handlers.set(type, fn) },
      window: {
        scrollY: 0, innerHeight: 900,
        matchMedia: () => ({ matches: motion === 'reduced' }),
        scrollTo: (first: number | { top: number }, second?: number) => scrolls.push(typeof first === 'number' ? second! : first.top),
        history: { replaceState: () => { throw new Error('History reveal must not change the URL'); } },
        setTimeout: (fn: Function) => { timers.set(++nextId, fn); return nextId; },
        clearTimeout: (id: number) => timers.delete(id),
        addEventListener: (type: string, fn: Function, options?: AddEventListenerOptions) => {
          handlers.set(type, fn);
          options?.signal?.addEventListener('abort', () => handlers.delete(type), { once: true });
        },
        removeEventListener: (type: string) => handlers.delete(type),
      },
      performance: { now: () => 0 },
      scrollEasing: { getUseNative: () => motion === 'native', getEaser: () => (value: number) => value },
      requestAnimationFrame: (fn: Function) => { frames.set(++nextId, fn); return nextId; },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      setActiveLink: (id: string) => links.push(id), updateActiveFromScroll: () => {},
    };
    const scope = createPageScope();
    Object.assign(scope, { frame: env.requestAnimationFrame, timeout: env.window.setTimeout });
    Object.assign(env, { scope });
    new Function('env', `with (env) { ${scrollScript} }`)(env);
    const reveal = handlers.get('vcd:section-history-reveal')!;
    const previous = new Block('distant', 7000);
    const restored = new Block('research', 2500);
    reveal({ preventDefault() {}, detail: { block: previous } });
    const previousFrame = env.scrollRafId, previousTimer = env.scrollTimeoutId;
    reveal({ preventDefault() {}, detail: { block: restored } });
    expect(frames.has(previousFrame)).toBe(false);
    expect(timers.has(previousTimer)).toBe(false);
    if (motion === 'custom') {
      const frame = frames.get(env.scrollRafId)!;
      frame(1);
      frame(1001);
    }
    expect(scrolls.at(-1)).toBe(2348);
    expect(links.at(-1)).toBe('research');
    restored.isConnected = false;
    const count = scrolls.length;
    reveal({ preventDefault() {}, detail: { block: restored } });
    expect(scrolls).toHaveLength(count);
    const previousCancel = globalThis.cancelAnimationFrame;
    globalThis.cancelAnimationFrame = env.cancelAnimationFrame;
    try { scope.destroy(); } finally {
      if (previousCancel) globalThis.cancelAnimationFrame = previousCancel;
      else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    }
    expect(handlers.has('vcd:section-history-reveal')).toBe(false);
  });
}

test('drag reorder undoes and redoes section order and responsive spacing in one step', async () => {
  const editor = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
  const start = editor.indexOf("    window.addEventListener('vcd:dev-section-reordered', ((event");
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    editor.slice(start, editor.indexOf("    window.addEventListener('vcd:dev-section-structure-changed'", start)),
  );
  const pageHistory = createHistory();
  const before = [{}, {}, {}];
  const after = [before[1], before[2], before[0]];
  const spacingStates = before.map((element, index) => {
    const currentValue = { desktop: ['none', 'section', 'related'][index], tablet: 'group', mobile: 'related' };
    return { element, document: 'sabi', currentValue, visualSavedValue: { ...currentValue } };
  });
  const stateValues = () => spacingStates.map(({ currentValue, visualSavedValue }) => [currentValue, visualSavedValue]);
  const initial = structuredClone(stateValues());
  let order = after;
  let listener: (event: CustomEvent) => void = () => {};
  new Function('env', `with(env) { ${code} }`)({
    window: { addEventListener: (_type: string, fn: typeof listener) => { listener = fn; }, dispatchEvent() {} },
    editorSignal: new AbortController().signal,
    pageHistory, spacingStates, spacingHistoryValues: new WeakMap(),
    reorderProjectStackSpacingSeams,
    captureFieldHistory() {}, cloneSpacing: structuredClone,
    spacingEqual: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
    applySpacingClass() {}, syncSpacingControl() {}, syncPageTopSpacingControls() {},
    syncIntroRunControls() {}, updateActions() {}, stickyStatus: 'Saved.',
  });
  listener(new CustomEvent('vcd:dev-section-reordered', { detail: {
    document: 'sabi', before, after, moved: before[0], destinationSide: 'after',
    restoreOrder: (direction: string) => { order = direction === 'before' ? before : after; },
  } }));
  const reordered = structuredClone(stateValues());
  expect(reordered).not.toEqual(initial);
  await pageHistory.undo();
  expect(order).toBe(before);
  expect(stateValues()).toEqual(initial);
  expect(pageHistory.canUndo).toBe(false);
  await pageHistory.redo();
  expect(order).toBe(after);
  expect(stateValues()).toEqual(reordered);
});

test('pending section order identifies the dragged block and survives a structural refresh', () => {
  const editor = readFileSync(new URL('../../src/components/DevSectionReorderEditor.astro', import.meta.url), 'utf8');
  const start = editor.indexOf('  const pendingReorderRoots');
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    editor.slice(start, editor.indexOf('  const controller', start)),
  );
  const roots = [{ id: 0 }, { id: 1 }, { id: 2 }];
  let order = [roots[1], roots[2], roots[0]];
  let event: CustomEvent | undefined;
  const stage = new Function('env', `with (env) { ${code}; return syncPending; }`)({
    documentKey: 'sabi', baselineOrder: [0, 1, 2], baselineOrders: new Map([['sabi', [0, 1, 2]]]),
    dropZone: () => ({ classList: { add() {}, remove() {} } }),
    captureSectionOrder: () => order.map((root) => root.id),
    getSectionRootsInDomOrder: () => order,
    ordersMatch: (left: number[], right: number[]) => JSON.stringify(left) === JSON.stringify(right),
    syncDevSectionOutlineSidebar() {}, getDevSectionOutline: () => [],
    window: { dispatchEvent: (next: CustomEvent) => { event = next; } },
  });
  stage(undefined, undefined, roots[0]);
  expect(event?.detail.root).toBe(roots[0]);
  expect(event?.detail.payload.order).toEqual([1, 2, 0]);
  stage();
  expect(event?.detail.root).toBe(roots[0]);
  order = roots;
  stage();
  expect(event?.type).toBe('vcd:dev-pending-remove');
});
