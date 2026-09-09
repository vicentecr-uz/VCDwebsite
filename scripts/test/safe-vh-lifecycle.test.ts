import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { introLayout } from '../../src/lib/projectIntro';

function setup(finePointer = true) {
  const source = readFileSync(new URL('../../src/lib/safeVh.ts', import.meta.url), 'utf8');
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(source.indexOf('export function bindSafeVh')).replace('export function', 'function'));
  const handlers = new Map<string, () => void>();
  const frames = new Map<number, () => void>();
  let nextFrame = 0, height = 0, measurements = 0, gap = 0, dragging = false, contentHeight = 400;
  const window = {
    innerWidth: 1200, innerHeight: 800,
    dispatchEvent: (event: Event) => { if (event.type === 'vcd:intro-layout-ready') expect(measurements).toBe(1); return true; },
    matchMedia: () => ({ matches: finePointer }),
    addEventListener: (type: string, fn: () => void) => handlers.set(type, fn),
  };
  const env = {
    window,
    document: { documentElement: { dataset: {}, classList: { contains: () => dragging } }, fonts: { ready: { then() {} } } },
    BOUND_FLAG: '__bound',
    requestAnimationFrame: (fn: () => void) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setSafeVh: () => { height = window.innerHeight; },
    setIntroFoldOffsets: () => { measurements++; gap = introLayout(100, height, contentHeight).outerGapPx; },
  };
  const bind = new Function('env', `with(env) { ${script}; return bindSafeVh; }`)(env);
  bind();
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  const fire = (type: string) => { handlers.get(type)?.(); flush(); };
  return { window, bind, fire, flush, handlers, content: (height: number) => { contentHeight = height; }, drag: (active: boolean) => { dragging = active; }, state: () => ({ height, measurements, gap }) };
}

test('desktop height-only resize recenters a 100% intro without a reload', () => {
  const context = setup();
  expect(context.state().gap).toBe(200);
  context.window.innerHeight = 1200;
  context.fire('resize');
  expect(context.state()).toEqual({ height: 1200, measurements: 2, gap: 400 });
  context.window.innerHeight = 700;
  context.fire('resize');
  expect(context.state().gap).toBe(150);
});

test('touch toolbar height changes keep the stable viewport; width changes refresh it', () => {
  const context = setup(false);
  context.window.innerHeight = 900;
  context.fire('resize');
  expect(context.state()).toEqual({ height: 800, measurements: 1, gap: 200 });
  context.window.innerWidth = 800;
  context.fire('resize');
  expect(context.state()).toEqual({ height: 900, measurements: 2, gap: 250 });
});

test('mode changes synchronize after listeners finish and coalesce within a frame', () => {
  const context = setup();
  context.handlers.get('vcd:dev-mode-change')?.();
  context.handlers.get('vcd:intro-layout-sync')?.();
  expect(context.state().measurements).toBe(1);
  context.flush();
  expect(context.state().measurements).toBe(2);
  context.content(600);
  context.fire('vcd:dev-mode-change');
  expect(context.state()).toEqual({ height: 800, measurements: 3, gap: 100 });
});

test('unchanged resize and repeated binding do not trigger layout work', () => {
  const context = setup();
  context.bind();
  context.fire('resize');
  expect(context.state().measurements).toBe(1);
});

test('orientation refreshes the dimensions; reorder retains ownership of geometry', () => {
  const context = setup(false);
  context.window.innerWidth = 800;
  context.window.innerHeight = 1200;
  context.fire('orientationchange');
  context.fire('resize');
  expect(context.state().measurements).toBe(2);
  context.drag(true);
  context.fire('vcd:intro-layout-sync');
  expect(context.state().measurements).toBe(2);
  context.drag(false);
  context.fire('vcd:intro-layout-sync');
  expect(context.state().measurements).toBe(3);
});
