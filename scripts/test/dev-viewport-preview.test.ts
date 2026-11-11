import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../../src/components/DevViewportPreview.astro', import.meta.url), 'utf8');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.split('<script>')[1].split('</script>')[0]
  .replace(/^\s*import .*;$/gm, '').replace('import.meta.hot?.dispose(dispose);', 'return dispose;'));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture(reduced = false, frameMode = false) {
  const window = new Window({ url: 'http://localhost:4322/', settings: { disableIframePageLoading: true } });
  const document = window.document;
  document.documentElement.classList.add('is-dev-mode');
  document.body.innerHTML = `<main><button id="focus">Edit</button></main><div data-dev-viewport-preview hidden>
    <div data-viewport-backdrop></div><div data-viewport-shadow></div>
    <div data-viewport-surface><iframe data-viewport-frame></iframe></div>
    <div data-viewport-controls>${['desktop', 'tablet', 'mobile'].map(p => `<button data-viewport-preset="${p}">${p}</button>`).join('')}
    <span data-viewport-size></span></div></div>`;
  const root = document.querySelector<HTMLElement>('[data-dev-viewport-preview]')!;
  const surface = root.querySelector<HTMLElement>('[data-viewport-surface]')!;
  const frame = root.querySelector<HTMLIFrameElement>('iframe')!;
  const controls = root.querySelector<HTMLElement>('[data-viewport-controls]')!;
  controls.getBoundingClientRect = () => ({ height: 40 }) as DOMRect;
  const child = new Window({ url: window.location.href });
  Object.defineProperty(frame, 'contentWindow', { value: child });
  Object.defineProperty(frame, 'contentDocument', { value: child.document });
  const posts: unknown[] = [];
  if (frameMode) {
    Object.defineProperty(window, 'parent', { value: { postMessage: (data: unknown) => posts.push(data) } });
    window.name = 'vcd-edit-viewport-preview';
  }
  let reloads = 0;
  Object.defineProperty(window.location, 'reload', { value: () => reloads++ });
  const animations: Array<{
    element: HTMLElement; keys: Record<string, string>[]; options: KeyframeAnimationOptions;
    running: boolean; current: Record<string, string>; finish: () => void; cancel: () => void;
  }> = [];
  window.HTMLElement.prototype.animate = function(keys: Record<string, string>[], options: KeyframeAnimationOptions) {
    let resolve!: () => void;
    let reject!: () => void;
    const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const animation = {
      element: this, keys, options, running: true, current: { ...keys[0] }, finished,
      finish() { animation.current = { ...keys[1] }; resolve(); },
      cancel() { animation.running = false; reject(); },
    };
    animations.push(animation);
    return animation;
  } as typeof window.HTMLElement.prototype.animate;
  const css = (property: string) => property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const computed = (element: HTMLElement) => ({
    getPropertyValue(property: string) {
      const animation = animations.findLast(a => a.element === element && a.running && css(property) in a.current);
      return animation?.current[css(property)] ?? element.style.getPropertyValue(property) ?? '';
    },
  });
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const cleanups: Array<() => void> = [];
  const scope = {
    signal: { aborted: false },
    listen(target: EventTarget, event: string, listener: EventListener, options?: boolean) {
      target.addEventListener(event, listener, options);
      cleanups.push(() => target.removeEventListener(event, listener, options));
    },
    frame(callback: () => void) { callback(); },
    timeout(callback: () => void, delay: number) { timers.push({ callback, delay }); },
    add(callback: () => void) { cleanups.push(callback); },
    destroy() { scope.signal.aborted = true; cleanups.reverse().forEach(fn => fn()); },
  };
  const dispose = new Function('window', 'document', 'HTMLElement', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'matchMedia', 'sessionStorage', 'createPageScope', 'onPageLoad', script)(
    window, document, window.HTMLElement, window.CustomEvent, window.MutationObserver,
    computed, () => ({ matches: reduced }), window.sessionStorage, () => scope, (mount: () => () => void) => mount(),
  );
  const request = (preset: string) => window.dispatchEvent(new window.CustomEvent('vcd:edit-viewport-request', { detail: { preset } }));
  const message = (type: string, extra = {}) => window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: child, data: { type, ...extra } }));
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await flush();
      animations.filter(a => a.running).forEach(a => a.finish());
    }
  };
  const assertPreset = (preset: string) => {
    expect(root.dataset.viewportStagePreset).toBe(preset);
    root.querySelectorAll<HTMLElement>('[data-viewport-preset]').forEach(button => {
      expect(button.classList.contains('is-active')).toBe(button.dataset.viewportPreset === preset);
      expect(button.getAttribute('aria-pressed')).toBe(String(button.dataset.viewportPreset === preset));
    });
  };
  return { window, document, root, surface, frame, controls, animations, timers, child, posts, request, message, settle, assertPreset, reloads: () => reloads,
    dispose: async () => { dispose(); await window.happyDOM.abort(); await child.happyDOM.abort(); } };
}

test('prewarms, morphs, switches without reloading, and restores the untouched parent', async () => {
  const f = fixture();
  try {
    const focus = f.document.getElementById('focus')!;
    focus.focus();
    f.assertPreset('desktop');
    f.request('tablet');
    expect(f.surface.style.opacity).toBe('0');
    expect(f.animations).toHaveLength(0);
    expect(f.frame.style.width).toBe('820px');
    expect(f.document.querySelector('main')!.inert).toBe(true);
    f.message('vcd-viewport-preview-edited');
    await flush();
    expect(f.animations[0].options.duration).toBe(120);
    await f.settle();
    f.assertPreset('tablet');
    const clip = f.animations.find(a => a.keys[1].clipPath)!;
    expect(clip.options.duration).toBe(420);
    expect(clip.keys[0].clipPath).toBe('inset(0px 0px 0px 0px round 0px)');
    expect(f.animations.find(a => a.element === f.frame)!.options.delay).toBe(240);
    const src = f.frame.src;
    f.request('mobile');
    await f.settle();
    expect(f.frame.src).toBe(src);
    expect(f.frame.style.width).toBe('390px');
    expect(f.root.querySelector('[data-viewport-size]')!.textContent).toMatch(/^390 × 844 · \d+%$/);
    f.assertPreset('mobile');
    f.request('desktop');
    await f.settle();
    expect(f.reloads()).toBe(0);
    expect(f.root.hidden).toBe(true);
    expect(f.frame.src).toBe('about:blank');
    expect(f.document.querySelector('main')!.inert).toBe(false);
    expect(f.document.activeElement).toBe(focus);
    expect(f.document.documentElement.hasAttribute('data-viewport-previewing')).toBe(false);
    f.assertPreset('desktop');
  } finally { await f.dispose(); }
});

test('retargets from the computed clip and cancels stale opening/closing work', async () => {
  const f = fixture();
  try {
    f.request('tablet');
    f.message('vcd-viewport-preview-edited');
    await flush();
    f.animations[0].finish();
    await flush();
    const morph = f.animations.find(a => a.keys[1].clipPath)!;
    const midway = 'inset(20px 30px 40px 50px round 10px)';
    morph.current.clipPath = midway;
    f.request('mobile');
    await f.settle();
    expect(morph.running).toBe(false);
    expect(f.animations.filter(a => a.keys[1].clipPath).at(-1)!.keys[0].clipPath).toBe(midway);
    f.assertPreset('mobile');
    f.request('desktop');
    await flush();
    f.request('tablet');
    await f.settle();
    expect(f.root.hidden).toBe(false);
    f.assertPreset('tablet');
    expect(f.frame.style.width).toBe('820px');
    f.request('desktop');
    await f.settle();
    expect(f.root.hidden).toBe(true);
  } finally { await f.dispose(); }
});

test('waits for restored scroll, falls back at 1500ms, and reloads only after a frame write', async () => {
  const f = fixture();
  try {
    f.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { code: 'Digit2', altKey: true, bubbles: true }));
    f.message('vcd-viewport-preview-edited');
    await flush();
    expect(f.animations).toHaveLength(0);
    f.message('vcd-viewport-preview-restored');
    await f.settle();
    f.message('vcd-viewport-preview-saved');
    f.message('vcd-viewport-preview-preset', { preset: 'desktop' });
    await f.settle();
    expect(f.reloads()).toBe(1);
    expect(f.window.sessionStorage.getItem('vcd-viewport-preview-restore')).not.toBeNull();
  } finally { await f.dispose(); }
  const fallback = fixture();
  try {
    fallback.request('mobile');
    fallback.timers.find(timer => timer.delay === 1500)!.callback();
    await fallback.settle();
    fallback.assertPreset('mobile');
    expect(fallback.surface.style.opacity).toBe('1');
  } finally { await fallback.dispose(); }
});

test('retains fade durations with reduced motion and reports both disk-write events from the frame', async () => {
  const f = fixture(true);
  try {
    f.request('mobile');
    f.message('vcd-viewport-preview-edited');
    await f.settle();
    expect(f.animations.some(a => 'clipPath' in a.keys[1])).toBe(false);
    expect(f.animations.find(a => a.element === f.controls)!.keys[0].transform).toBe('translate(-50%, 0px)');
    expect(f.animations.find(a => a.element === f.frame)!.options.duration).toBe(180);
    expect(f.animations[0].options.duration).toBe(120);
  } finally { await f.dispose(); }
  const child = fixture(false, true);
  try {
    child.window.dispatchEvent(new child.window.Event('vcd:dev-pending-committed'));
    child.window.dispatchEvent(new child.window.Event('vcd:dev-content-written'));
    expect(child.posts.filter((post: any) => post.type === 'vcd-viewport-preview-saved')).toHaveLength(2);
  } finally { await child.dispose(); }
});

test('refuses dirty parent drafts and vetoed frame exits', async () => {
  const f = fixture();
  try {
    const dirty = (event: any) => { event.detail.dirty = true; };
    f.window.addEventListener('vcd:dev-viewport-preview-dirty-check', dirty);
    f.request('tablet');
    expect(f.root.hidden).toBe(true);
    f.window.removeEventListener('vcd:dev-viewport-preview-dirty-check', dirty);
    f.request('mobile');
    f.message('vcd-viewport-preview-edited');
    await f.settle();
    f.child.addEventListener('vcd:before-reload', event => event.preventDefault());
    f.request('desktop');
    await f.settle();
    expect(f.root.hidden).toBe(false);
    f.assertPreset('mobile');
  } finally { await f.dispose(); }
});
