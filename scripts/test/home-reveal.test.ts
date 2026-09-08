import { afterEach, describe, expect, test } from 'bun:test';
import { HOME_REVEAL_DURATION, HOME_REVEAL_EASING, HOME_REVEAL_STAGGER, createHomeRevealController, groupHomeRevealRows, makeHomeRevealCloneVisible } from '../../src/lib/homeReveal';

class FakeElement {
  hidden = false; style: Record<string, string> = { opacity: '', visibility: '', transform: '', filter: '' };
  parentElement: FakeElement | null = null; children: FakeElement[] = []; animations: Array<{ options: KeyframeAnimationOptions; cancel: () => void; finished: Promise<void> }> = [];
  constructor(public rect = { top: 10, left: 0, width: 100, height: 20 }, public className = '') {}
  classList = { contains: (name: string) => this.className.split(' ').includes(name) };
  hasAttribute() { return false; }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  closest() { return null; }
  querySelectorAll<T>() { return [] as T[]; }
  cloneNode() { return new FakeElement(this.rect); }
  setAttribute() {}
  append(child: FakeElement) { this.children.push(child); }
  remove() {}
  animate(_keyframes: Keyframe[], options: KeyframeAnimationOptions) { const animation = { options, cancel() {}, finished: Promise.resolve() }; this.animations.push(animation); return animation; }
}
const fakeWindow = (reduce = false) => {
  const listeners = new Map<string, Set<EventListener>>();
  return { innerHeight: 800, matchMedia: () => ({ matches: reduce }), addEventListener(name: string, fn: EventListener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); }, removeEventListener(name: string, fn: EventListener) { listeners.get(name)?.delete(fn); }, emit(name: string) { listeners.get(name)?.forEach((fn) => fn({ type: name } as Event)); }, listenerCount(name: string) { return listeners.get(name)?.size ?? 0; } } as unknown as Window & { emit: (name: string) => void; listenerCount: (name: string) => number };
};
const savedDocument = globalThis.document;
afterEach(() => { Object.assign(globalThis, { document: savedDocument }); });

describe('home reveal choreography', () => {
  test('groups equal-top units and delays the final row across the specified span', () => {
    const rows = groupHomeRevealRows([
      { top: 300, left: 20 }, { top: 100, left: 40 }, { top: 101, left: 10 }, { top: 500, left: 0 },
    ]);
    expect(rows.map((row) => row.units.length)).toEqual([2, 1, 1]);
    expect(rows[0].delay).toBe(0);
    expect(rows.at(-1)?.delay).toBeCloseTo(HOME_REVEAL_STAGGER, 5);
    expect((rows.at(-1)?.delay ?? 0) + HOME_REVEAL_DURATION).toBeCloseTo(1000, 2);
  });

  test('keeps the exact WAAPI timing contract', () => {
    expect(HOME_REVEAL_DURATION).toBe(449.28);
    expect(HOME_REVEAL_STAGGER).toBe(550.72);
    expect(HOME_REVEAL_EASING).toContain('linear(0 0%, 0.006234 1%');
    expect(HOME_REVEAL_EASING).toContain('1.000058 50%, 1 100%)');
  });

  test('gives the first content row a lead after the header row', () => {
    const rows = groupHomeRevealRows([{ top: 0, left: 0, kind: 'header' }, { top: 100, left: 0, kind: 'media' }, { top: 500, left: 0, kind: 'media' }]);
    expect(rows[0].delay).toBe(0); expect(rows[1].delay).toBe(120); expect(rows[2].delay).toBe(HOME_REVEAL_STAGGER);
  });

  test('prepared visual text clones are visible to opacity animation', () => {
    const clone = { style: { visibility: 'hidden' } } as unknown as HTMLElement;
    makeHomeRevealCloneVisible(clone);
    expect(clone.style.visibility).toBe('visible');
  });

  test('arms under inert Home, reveals after dismissal, then restores source styles', async () => {
    const header = new FakeElement(); const home = new FakeElement(); home.children = [header];
    home.querySelectorAll = <T>(selector: string) => selector.includes('site-header-slot') ? [header] as unknown as T[] : [];
    Object.assign(globalThis, { document: { fonts: undefined, documentElement: { clientHeight: 800 } } });
    const win = fakeWindow(); const controller = createHomeRevealController(home as unknown as HTMLElement, win);
    expect(controller.isArmed()).toBe(true); expect(header.style.opacity).toBe('0');
    win.emit('vcd:home-intro-dismissed'); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(header.animations).toHaveLength(1); await Promise.resolve();
    expect(header.style.opacity).toBe(''); controller.destroy();
  });

  test('reduced motion preserves spatial row delays while omitting transform/filter', async () => {
    const first = new FakeElement({ top: 10, left: 0, width: 100, height: 20 }); const last = new FakeElement({ top: 500, left: 0, width: 100, height: 20 }); const home = new FakeElement(); home.children = [first, last];
    home.querySelectorAll = <T>(selector: string) => selector.includes('project-grid__cover') ? [first, last] as unknown as T[] : [];
    Object.assign(globalThis, { document: { fonts: undefined, documentElement: { clientHeight: 800 } } });
    const win = fakeWindow(true); const controller = createHomeRevealController(home as unknown as HTMLElement, win); win.emit('vcd:home-intro-dismissed'); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.animations[0]?.options.delay).toBe(0); expect(last.animations[0]?.options.delay).toBeCloseTo(HOME_REVEAL_STAGGER, 5); controller.destroy();
  });

  test('explicit reduced-motion override wins over the media query', async () => {
    const item = new FakeElement({ top: 10, left: 0, width: 100, height: 20 }); const home = new FakeElement();
    home.querySelectorAll = <T>(selector: string) => selector.includes('project-grid__cover') ? [item] as unknown as T[] : [];
    Object.assign(globalThis, { document: { fonts: undefined, documentElement: { clientHeight: 800 } } });
    const controller = createHomeRevealController(home as unknown as HTMLElement, fakeWindow(false), undefined, { reducedMotion: true });
    controller.run(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(item.animations[0]?.options.easing).toBe(HOME_REVEAL_EASING); controller.destroy();
  });

  test('resize rebuilds before dismissal and removes listeners on destroy', async () => {
    const item = new FakeElement(); const home = new FakeElement(); home.querySelectorAll = <T>() => [item] as unknown as T[];
    Object.assign(globalThis, { document: { fonts: undefined, documentElement: { clientHeight: 800 } } });
    const win = fakeWindow(); const controller = createHomeRevealController(home as unknown as HTMLElement, win); win.emit('resize'); await Promise.resolve();
    expect(controller.isArmed()).toBe(true); controller.destroy(); expect(win.listenerCount('resize')).toBe(0); expect(win.listenerCount('pageshow')).toBe(0);
  });

  test('clones the body-text block so its subtree styling survives line splitting', async () => {
    const textBlock = new FakeElement(); const home = new FakeElement();
    home.querySelectorAll = <T>(selector: string) => selector.includes('.project-body-text') ? [textBlock] as unknown as T[] : [];
    Object.assign(globalThis, { document: { fonts: undefined, documentElement: { clientHeight: 800 } } });
    const win = fakeWindow(); const controller = createHomeRevealController(home as unknown as HTMLElement, win);
    expect(textBlock.style.opacity).toBe('0'); win.emit('vcd:home-intro-dismissed'); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(home.children).toHaveLength(1);
    expect(home.children[0]?.style.visibility).toBe('visible'); controller.destroy();
  });

  test('uses the project cover, not stack or metadata, as media unit', () => {
    const cover = new FakeElement(); const home = new FakeElement(); let mediaSelector = '';
    home.querySelectorAll = <T>(selector: string) => { if (selector.includes('project-grid__cover')) { mediaSelector = selector; return [cover] as unknown as T[]; } return []; };
    Object.assign(globalThis, { document: { fonts: undefined, documentElement: { clientHeight: 800 } } });
    const controller = createHomeRevealController(home as unknown as HTMLElement, fakeWindow());
    expect(mediaSelector).toContain('.project-grid__cover'); expect(mediaSelector).not.toContain('.project-grid__stack'); expect(mediaSelector).not.toContain('.project-grid__meta'); controller.destroy();
  });
});
