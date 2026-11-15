import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../../src/components/DevOverlay.astro', import.meta.url), 'utf8');
const start = component.indexOf('    const clamp =');
const end = component.indexOf('    const GAP = 8;', start);
const positionSource = component.slice(start, end);
const positionCompiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  positionSource + '\nreturn { savePosition, readPosition, applyPosition, applyPreferredPosition, restorePosition };',
);

function fixture(stored: string | null = null) {
  const window = new Window({ url: 'http://localhost:4323' });
  Object.defineProperties(window, { innerWidth: { value: 1000, writable: true }, innerHeight: { value: 800, writable: true } });
  const overlay = window.document.createElement('div');
  let width = 200;
  let height = 160;
  const transitionSamples: string[] = [];
  Object.defineProperties(overlay, {
    offsetWidth: { get: () => width },
    offsetHeight: { get: () => height },
  });
  overlay.getBoundingClientRect = () => {
    transitionSamples.push(overlay.style.transition);
    return {
    left: Number.parseFloat(overlay.style.left) || 0,
    top: Number.parseFloat(overlay.style.top) || 0,
    width,
    height,
    right: (Number.parseFloat(overlay.style.left) || 0) + width,
    bottom: (Number.parseFloat(overlay.style.top) || 0) + height,
    } as DOMRect;
  };
  if (stored !== null) window.localStorage.setItem('devOverlay:test:position', stored);
  const position = new Function(
    'window',
    'overlay',
    'embedded',
    'positionStorageKey',
    positionCompiled,
  )(window, overlay, false, 'devOverlay:test:position');
  return {
    window,
    overlay,
    position,
    resize(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
    },
    transitionSamples,
  };
}

test('coordinate probes keep the panel entrance fade enabled', () => {
  const f = fixture();
  f.position.applyPosition(300, 240, false);
  expect(f.transitionSamples.length).toBeGreaterThan(0);
  expect(f.transitionSamples.every((transition) => transition === '')).toBe(true);
});

test('persists top-left fractions and restores proportional position without panel-size subtraction', () => {
  const f = fixture();
  f.position.savePosition(300, 240);
  expect(JSON.parse(f.window.localStorage.getItem('devOverlay:test:position')!)).toEqual({ x: 0.3, y: 0.3 });
  f.position.applyPreferredPosition();
  expect(f.overlay.getBoundingClientRect().left).toBe(300);
  expect(f.overlay.getBoundingClientRect().top).toBe(240);
  f.window.innerWidth = 600;
  f.window.innerHeight = 400;
  f.position.applyPreferredPosition();
  expect(f.overlay.getBoundingClientRect().left).toBe(180);
  expect(f.overlay.getBoundingClientRect().top).toBe(120);
  expect(JSON.parse(f.window.localStorage.getItem('devOverlay:test:position')!)).toEqual({ x: 0.3, y: 0.3 });
});

test('defers legacy center and absolute migration until the panel has rendered', () => {
  for (const [stored, expected] of [
    ['{"u":0.5,"v":0.5}', { x: 0.4, y: 0.4 }],
    ['{"left":300,"top":240}', { x: 0.3, y: 0.3 }],
  ] as const) {
    const f = fixture(stored);
    f.resize(0, 0);
    f.position.restorePosition();
    expect(f.window.localStorage.getItem('devOverlay:test:position')).toBe(stored);
    f.resize(200, 160);
    f.position.restorePosition();
    expect(JSON.parse(f.window.localStorage.getItem('devOverlay:test:position')!)).toEqual(expected);
  }
});

test('viewport clamping does not overwrite the stored proportional preference', () => {
  const f = fixture('{"x":0.9,"y":0.9}');
  f.position.applyPreferredPosition();
  expect(f.overlay.getBoundingClientRect().left).toBe(800);
  expect(f.overlay.getBoundingClientRect().top).toBe(640);
  f.window.innerWidth = 300;
  f.window.innerHeight = 250;
  f.position.applyPreferredPosition();
  expect(f.overlay.getBoundingClientRect().left).toBe(100);
  expect(f.overlay.getBoundingClientRect().top).toBe(90);
  expect(JSON.parse(f.window.localStorage.getItem('devOverlay:test:position')!)).toEqual({ x: 0.9, y: 0.9 });
});

test('resizing suppresses position writes but still snaps, while content resize clamps the current rect', () => {
  const f = fixture();
  let resizeCallback: (entries: Array<{ borderBoxSize: Array<{ blockSize: number }>; contentRect: { height: number } }>) => void;
  class FakeResizeObserver {
    constructor(callback: typeof resizeCallback) {
      resizeCallback = callback;
    }
    observe() {}
    disconnect() {}
  }
  const observerStart = component.indexOf('    let lastObservedHeight');
  const observerEnd = component.indexOf('    restorePosition();', observerStart);
  const observerSource = component.slice(observerStart, observerEnd);
  const observerCompiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(observerSource);
  const collapse = { animating: false };
  let minimized = false;
  const setMinimized = (value: boolean) => { minimized = value; };
  let positionWrites = 0;
  const applyPosition = (...args: Parameters<typeof f.position.applyPosition>) => {
    positionWrites += 1;
    f.position.applyPosition(...args);
  };
  new Function(
    'window',
    'overlay',
    'embedded',
    'collapse',
    'wantVisible',
    'ownObserver',
    'ResizeObserver',
    'applyPosition',
    'restorePosition',
    'legacyCenter',
    'legacyPosition',
    'portraitScheduleConstrain',
    'SNAP_TO_MINIMIZE_BELOW',
    'heightBeforeResizeGesture',
    'setMinimized',
    observerCompiled,
  )(
    f.window,
    f.overlay,
    false,
    collapse,
    true,
    (observer: FakeResizeObserver) => observer,
    FakeResizeObserver,
    applyPosition,
    f.position.restorePosition,
    null,
    null,
    null,
    72,
    '160px',
    setMinimized,
  );
  const callback = resizeCallback!;
  f.overlay.classList.add('is-dev-overlay-open');

  f.resize(200, 160);
  callback([{ borderBoxSize: [{ blockSize: 160 }], contentRect: { height: 160 } }]);
  positionWrites = 0;
  f.overlay.style.left = '950px';
  f.overlay.style.top = '30px';
  f.overlay.classList.add('is-resizing');
  f.resize(200, 60);
  callback([{ borderBoxSize: [{ blockSize: 60 }], contentRect: { height: 60 } }]);
  expect(positionWrites).toBe(0);
  expect(minimized).toBe(true);
  expect(f.overlay.dataset.restoredHeight).toBe('160px');

  f.overlay.classList.remove('is-resizing');
  f.resize(200, 120);
  callback([{ borderBoxSize: [{ blockSize: 120 }], contentRect: { height: 120 } }]);
  expect(positionWrites).toBe(1);
  expect(f.overlay.getBoundingClientRect().left).toBe(800);
});

test('portrait opening clears the stale natural cap before showing and schedules a fresh cap after opening', () => {
  for (const height of ['', '220px']) {
    const f = fixture();
    f.overlay.classList.add('dev-overlay--portrait');
    f.overlay.style.maxHeight = '280px';
    f.overlay.style.height = height;
    const frames: Array<() => void> = [];
    let constrained = 0;
    const showStart = component.indexOf('    const finishShow =');
    const showEnd = component.indexOf('    const showOverlay =', showStart);
    const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(component.slice(showStart, showEnd) + '\nfinishShow();');
    new Function('overlay', 'body', 'setNativeHidden', 'restorePosition', 'scope', 'wantVisible', 'portraitScheduleConstrain', compiled)(
      f.overlay, { scrollTop: 0 }, () => {
        expect(f.overlay.style.maxHeight).toBe(height ? '280px' : '');
      }, () => {}, { frame: (fn: () => void) => frames.push(fn) }, true, () => {
        expect(f.overlay.classList.contains('is-dev-overlay-open')).toBe(true);
        constrained++;
      },
    );
    expect(constrained).toBe(0);
    frames.shift()!();
    frames.shift()!();
    expect(constrained).toBe(1);
  }
});

test('hoisted overlay ignores page resize and unrelated chrome moves but follows shell resize', () => {
  const f = fixture();
  const shell = new Window();
  shell.document.body.append(f.overlay);
  const listeners: Array<[EventTarget, string, EventListener]> = [];
  let positions = 0;
  const start = component.indexOf('    const onViewportResize =');
  const end = component.indexOf('\n  };', start);
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(component.slice(start, end).replace('import.meta.env.DEV', 'true'));
  new Function('window', 'overlay', 'embedded', 'preferredPosition', 'portraitScheduleConstrain', 'applyPreferredPosition', 'applyPosition', 'scope', compiled)(
    f.window, f.overlay, false, { x: 0.3, y: 0.3 }, () => {}, () => positions++, () => positions++, {
      listen(target: EventTarget, type: string, fn: EventListener) { target.addEventListener(type, fn); listeners.push([target, type, fn]); },
      add() {},
    },
  );
  expect(positions).toBe(0);
  f.window.dispatchEvent(new f.window.Event('resize'));
  f.window.dispatchEvent(new f.window.Event('vcd:canvas-chrome-moved'));
  expect(positions).toBe(0);
  shell.dispatchEvent(new shell.Event('resize'));
  expect(positions).toBe(1);
  listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
});
