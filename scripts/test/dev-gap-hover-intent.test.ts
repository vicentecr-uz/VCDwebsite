import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'bun:test';

const source = fs.readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function createHarness() {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const runTimers = (advance: number) => {
    now += advance;
    [...timers.entries()].forEach(([id, timer]) => {
      if (timer.due > now) return;
      timers.delete(id);
      timer.callback();
    });
  };
  const window = {
    setTimeout(callback: () => void, delay: number) {
      const id = nextTimer++;
      timers.set(id, { due: now + delay, callback });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  };
  const drawingMenu = { open: false };
  const drawingControls: Array<{ getBoundingClientRect: () => object }> = [];
  const root = { classList: { toggle() {}, remove() {} }, hasAttribute: () => drawingMenu.open };
  const document = {
    activeElement: null,
    documentElement: root,
    querySelector: () => null,
    querySelectorAll: () => drawingControls,
  };
  const makeClassList = () => {
    const names = new Set<string>();
    return {
      contains: (name: string) => names.has(name),
      toggle: (name: string, on: boolean) => on ? names.add(name) : names.delete(name),
      remove: (...values: string[]) => values.forEach((value) => names.delete(value)),
      add: (...values: string[]) => values.forEach((value) => names.add(value)),
    };
  };
  const makeState = (left: number, top = 0) => {
    const pill = { hidden: false, getBoundingClientRect: () => ({ left, right: left + 20, top, bottom: top + 20 }) };
    const control = {
      hidden: false,
      classList: makeClassList(),
      querySelector: (selector: string) => selector === '.dev-gap-toolbar__pill' ? pill : null,
      dataset: {},
      style: {},
    };
    return {
      control,
      element: { closest: () => ({}) },
      menu: { hidden: true, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) },
      addButton: {},
      spacingGroup: {},
    } as any;
  };
  const first = makeState(100);
  const second = makeState(300);
  const spacingStates = [first, second];
  const suppressionState = { value: false };
  const editingState = { value: true };
  const pinState = { add: false, spacing: false };
  const abortCallbacks: Array<() => void> = [];
  const editorSignal = { addEventListener(_name: string, callback: () => void) { abortCallbacks.push(callback); } };
  const env = {
    window,
    document,
    editorSignal,
    spacingStates,
    isDevContentEditing: () => editingState.value,
    gapsSuppressed: () => suppressionState.value,
    suppressionState,
    editingState,
    pinState,
    abortCallbacks,
    suppressGapProximity: false,
    isActiveSpacingState: () => true,
    isPointerOverHeaderChrome: () => false,
    isPageTopGapControl: () => false,
    isAddControlPinned: () => pinState.add,
    isSpacingControlPinned: () => pinState.spacing,
    isPointerOverToolbarHitbox: () => false,
    syncGapToolbarTopPin: () => {},
    pinGapToolbarTop: () => {},
    syncPageTopGapStacking: () => {},
    clearGapProximity: (control: any) => control.classList.remove('is-near-add', 'is-near-spacing'),
    closeSectionMenus: () => spacingStates.forEach((state) => {
      state.control.classList.remove('is-menu-open');
      state.menu.hidden = true;
    }),
    preventScrollWhileGapToolbarHeld: () => {},
  };
  const constants = source.slice(source.indexOf('  const SPACING_ENTRY_RADIUS_PX'), source.indexOf('\n\n  let editorAbortController'));
  const geometry = between('    /** Distance to the closest point', '    const isSectionMenuOpen');
  const intent = between('    let gapRevealTimer', '    const syncGapToolbarTopPin');
  const sync = between('    const syncSpacingProximity', '    // Caret suppression');
  const pointerStart = source.indexOf("        'pointermove',");
  const pointerBody = source.slice(source.indexOf('        (event) => {', pointerStart), source.indexOf("        }, { passive: true", pointerStart)) + '}';
  const wheelStart = source.indexOf("document.addEventListener('wheel', (event)");
  const wheelBody = source.slice(source.indexOf('(event) => {', wheelStart), source.indexOf("}, { passive: false", wheelStart)) + '}';
  const syntheticStart = source.indexOf("document.addEventListener('dev:sync-gap-proximity'");
  const syntheticBody = source.slice(source.indexOf('((event: CustomEvent', syntheticStart), source.indexOf(") as EventListener", syntheticStart)) + ')';
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${constants}\n${geometry}\n${intent}\n${sync}\nconst syncSpacingProximityApi = syncSpacingProximity;\nconst handlePointerMove = ${pointerBody};\nconst handleSynthetic = ${syntheticBody};\nconst handleWheel = ${wheelBody};\nreturn { syncSpacingProximity: syncSpacingProximityApi, handlePointerMove, handleSynthetic, handleWheel, setSuppressed: (value) => { suppressionState.value = value; }, setEditing: (value) => { editingState.value = value; }, setPinned: (kind, value) => { pinState[kind] = value; }, abort: () => abortCallbacks.forEach((callback) => callback()) };`);
  const api = new Function('env', `with (env) { ${compiled} }`)(env);
  return { first, second, drawingMenu, drawingControls, ...api, runTimers, advance: (amount: number) => { now += amount; } };
}

test('Drawings owns overlapping gap geometry and cancels pending or visible gap reveals', () => {
  const h = createHarness();
  h.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 100 });
  h.drawingControls.push({ getBoundingClientRect: () => ({ left: 100, right: 120, top: 0, bottom: 20, width: 20, height: 20 }) });
  h.runTimers(140);
  assert.equal(h.first.control.classList.contains('is-near-spacing'), false);
  h.drawingControls.length = 0;
  h.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 300 });
  h.runTimers(140);
  assert.equal(h.first.control.classList.contains('is-near-spacing'), true);
  h.drawingControls.push({ getBoundingClientRect: () => ({ left: 100, right: 120, top: 0, bottom: 20, width: 20, height: 20 }) });
  h.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 500 });
  assert.equal(h.first.control.classList.contains('is-near-spacing'), false);
});

test('an open drawing menu suppresses every gap until it closes', () => {
  const h = createHarness();
  h.drawingMenu.open = true;
  h.first.control.classList.add('is-menu-open');
  h.handlePointerMove({ buttons: 0, clientX: 305, clientY: 10, timeStamp: 100 });
  h.runTimers(140);
  assert.equal(h.first.control.classList.contains('is-menu-open'), false);
  assert.equal(h.second.control.classList.contains('is-near-spacing'), false);
  h.drawingMenu.open = false;
  h.handlePointerMove({ buttons: 0, clientX: 305, clientY: 10, timeStamp: 300 });
  h.runTimers(140);
  assert.equal(h.second.control.classList.contains('is-near-spacing'), true);
});

test('hidden gap waits for settled intent, then retains within 24px', () => {
  const harness = createHarness();
  harness.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 100 });
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), false);
  harness.runTimers(140);
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), true);
  harness.handlePointerMove({ buttons: 0, clientX: 143, clientY: 10, timeStamp: 200 });
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), true);
  harness.handlePointerMove({ buttons: 0, clientX: 145, clientY: 10, timeStamp: 300 });
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), false);
});

test('boundary exits and target changes cancel the pending winner', () => {
  const harness = createHarness();
  harness.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 0 });
  harness.handlePointerMove({ buttons: 0, clientX: 130, clientY: 10, timeStamp: 20 });
  harness.runTimers(140);
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), false);
  harness.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 200 });
  harness.handlePointerMove({ buttons: 0, clientX: 306, clientY: 10, timeStamp: 300 });
  harness.runTimers(140);
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), false);
  assert.equal(harness.second.control.classList.contains('is-near-spacing'), true);
});

test('fast travel resets intent, held buttons cancel it, and synthetic sync keeps the delay', () => {
  const harness = createHarness();
  harness.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 100 });
  harness.advance(100);
  harness.handlePointerMove({ buttons: 0, clientX: 112, clientY: 10, timeStamp: 101 });
  harness.runTimers(40);
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), false);
  harness.runTimers(100);
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), true);

  const held = createHarness();
  held.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 0 });
  held.handlePointerMove({ buttons: 1, clientX: 105, clientY: 10, timeStamp: 20 });
  held.runTimers(140);
  assert.equal(held.first.control.classList.contains('is-near-spacing'), false);

  const synthetic = createHarness();
  synthetic.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 0 });
  synthetic.handleSynthetic({ detail: { clientX: 105, clientY: 10 } });
  synthetic.runTimers(139);
  assert.equal(synthetic.first.control.classList.contains('is-near-spacing'), false);
  synthetic.runTimers(1);
  assert.equal(synthetic.first.control.classList.contains('is-near-spacing'), true);
});

test('suppression cancels pending intent and allows a later real move to re-arm', () => {
  const harness = createHarness();
  harness.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 0 });
  harness.setSuppressed(true);
  harness.syncSpacingProximity(105, 10);
  harness.runTimers(140);
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), false);
  harness.setSuppressed(false);
  harness.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 200 });
  harness.runTimers(140);
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), true);
});

test('disabled mode, abort, and keyboard or menu pins prevent accidental reveal', () => {
  const disabled = createHarness();
  disabled.setEditing(false);
  disabled.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 0 });
  disabled.runTimers(140);
  assert.equal(disabled.first.control.classList.contains('is-near-spacing'), false);

  const aborted = createHarness();
  aborted.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 0 });
  aborted.abort();
  aborted.runTimers(140);
  assert.equal(aborted.first.control.classList.contains('is-near-spacing'), false);

  const pinned = createHarness();
  pinned.setPinned('add', true);
  pinned.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 0 });
  assert.equal(pinned.first.control.classList.contains('is-near-add'), true);

  const openMenu = createHarness();
  openMenu.first.control.classList.add('is-menu-open');
  openMenu.handlePointerMove({ buttons: 0, clientX: 306, clientY: 10, timeStamp: 0 });
  openMenu.runTimers(140);
  assert.equal(openMenu.first.control.classList.contains('is-menu-open'), true);
  assert.equal(openMenu.first.control.classList.contains('is-near-add'), true);
});

test('wheel cancellation clears pending reveal intent', () => {
  const harness = createHarness();
  harness.handlePointerMove({ buttons: 0, clientX: 105, clientY: 10, timeStamp: 0 });
  harness.handleWheel({ clientX: 105, clientY: 10 });
  harness.runTimers(140);
  assert.equal(harness.first.control.classList.contains('is-near-spacing'), false);
});
