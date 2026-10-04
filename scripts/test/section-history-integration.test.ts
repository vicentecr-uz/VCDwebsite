import { createPageScope } from '../../src/lib/pageLifecycle';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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
      clickOffsetPx: 152, clickLockMs: 700, nav: { isConnected: true }, HTMLElement: Block,
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
    reveal({ detail: { block: previous } });
    const previousFrame = env.scrollRafId, previousTimer = env.scrollTimeoutId;
    reveal({ detail: { block: restored } });
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
    reveal({ detail: { block: restored } });
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
