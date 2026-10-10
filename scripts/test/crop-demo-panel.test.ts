import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/demos/CropFrameDemo.astro', import.meta.url), 'utf8')
  .split('<script>')[1].split('</script>')[0]
  .replaceAll('import.meta.env.DEV', 'false')
  .replace(/^\s*import .*?;\s*$/gm, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<vcd-crop-frame-demo>
    <div data-crop-panel class="dev-overlay is-dev-overlay-open">
      <button data-minimize-toggle aria-expanded="true"></button><button data-hide-toggle></button>
      <div data-overlay-body><button>Crop control</button><button data-crop-replace-assets>Asset manager</button><button data-demo-author-reset>Reset</button></div>
    </div>
    <button data-crop-viewport="desktop" aria-pressed="false"></button><button data-crop-viewport="tablet" aria-pressed="false"></button><button data-crop-viewport="mobile" aria-pressed="false"></button>
    <div class="crop-frame-demo__preview-column"><div class="crop-frame-demo__preview-shell"><iframe></iframe></div></div>
    <div class="project-image"><img src="/source.jpg"></div>
    <div data-demo-asset-picker hidden></div>
  </vcd-crop-frame-demo>`;
  const frame = document.querySelector('iframe') as HTMLIFrameElement;
  const frameHost = document.querySelector('.project-image')!;
  frame.contentDocument!.body.append(frameHost);
  const demoButtons = [...document.querySelectorAll<HTMLElement>('[data-crop-viewport]')];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  win.setTimeout = ((callback: () => void, delay?: number) => {
    if (delay !== 2000) throw new Error(`unexpected timer delay: ${delay}`);
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  }) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof win.clearTimeout;
  let cropActive = true;
  let cropReset = 0;
  let cropDestroyed = 0;
  let replacementReset = 0;
  let replacementDestroyed = 0;
  let cropCreated = 0;
  const errors: ErrorEvent[] = [];
  win.addEventListener('error', (event) => errors.push(event));
  let selectedViewport = 'desktop';
  let collapseDestroyed = 0;
  const collapseSets: Array<[boolean, boolean | undefined]> = [];
  const env = {
    HTMLElement: win.HTMLElement,
    customElements: win.customElements,
    document,
    window: win,
    AbortController: win.AbortController,
    ResizeObserver: class { observe() {} disconnect() {} },
    createDemoImageCrop: () => { cropCreated += 1; return ({
      reset() { cropReset += 1; },
      getState() { return { source: { src: '/source.jpg', width: 1, height: 1, alt: '' }, crop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.8 }, locked: true }; },
      restore() { return true; },
      setViewport(value: string) { selectedViewport = value; },
      getViewport() { return selectedViewport; },
      setActive(value: boolean) { cropActive = value; },
      destroy() { cropDestroyed += 1; },
    }); },
    createDemoImageReplacement: () => ({
      reset() { replacementReset += 1; },
      destroy() { replacementDestroyed += 1; },
    }),
    createDemoAssetPicker: () => ({ open: async () => undefined, destroy() {} }),
    createDemoImageViewport: () => ({ setViewport(value: string) { selectedViewport = value; demoButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.cropViewport === value))); }, getViewport() { return selectedViewport; }, destroy() {} }),
    createDevPanelCollapse: (panel: HTMLElement) => ({
      set(value: boolean, animate?: boolean) {
        collapseSets.push([value, animate]);
        panel.classList.toggle('is-minimized', value);
        panel.querySelector('[data-minimize-toggle]')?.setAttribute('aria-expanded', String(!value));
      },
      destroy() { collapseDestroyed += 1; },
    }),
  };
  new Function('env', `with (env) { ${compiled} }`)(env);
  frame.dispatchEvent(new win.Event('load'));
  const demo = document.querySelector('vcd-crop-frame-demo') as HTMLElement;
  const panel = demo.querySelector('[data-crop-panel]') as HTMLElement;
  const hide = panel.querySelector('[data-hide-toggle]') as HTMLButtonElement;
  const minimize = panel.querySelector('[data-minimize-toggle]') as HTMLButtonElement;
  const reset = demo.querySelector('[data-demo-author-reset]') as HTMLButtonElement;
  return { win, document, demo, panel, frame, hide, minimize, reset, timers, flushTimer: (id: number) => timers.get(id)?.(), errors, get cropCreated() { return cropCreated; }, get cropActive() { return cropActive; }, get cropReset() { return cropReset; }, get cropDestroyed() { return cropDestroyed; }, get replacementReset() { return replacementReset; }, get replacementDestroyed() { return replacementDestroyed; }, get collapseDestroyed() { return collapseDestroyed; }, get selectedViewport() { return selectedViewport; }, collapseSets };
}

test('minimize light toggles the real collapse controller', () => {
  const h = setup();
  h.minimize.click();
  expect(h.panel.classList.contains('is-minimized')).toBe(true);
  expect(h.collapseSets.at(-1)).toEqual([true, undefined]);
  h.minimize.click();
  expect(h.panel.classList.contains('is-minimized')).toBe(false);
  expect(h.collapseSets.at(-1)).toEqual([false, undefined]);
});

test('hide makes the panel inert and reopens exactly after 2000ms', () => {
  const h = setup();
  h.minimize.click();
  h.hide.click();
  expect(h.panel.inert).toBe(true);
  expect(h.panel.classList.contains('is-dev-overlay-open')).toBe(false);
  expect(h.cropActive).toBe(false);
  expect(h.timers.size).toBe(1);
  const timer = [...h.timers.keys()][0];
  h.flushTimer(timer);
  expect(h.panel.inert).toBe(false);
  expect(h.panel.classList.contains('is-dev-overlay-open')).toBe(true);
  expect(h.panel.classList.contains('is-minimized')).toBe(false);
  expect(h.cropActive).toBe(true);
  expect(h.collapseSets.at(-1)).toEqual([false, false]);
});

test('reset cancels a scheduled reopen and expands panel alongside the action controller', () => {
  const h = setup();
  h.hide.click();
  expect(h.timers.size).toBe(1);
  h.reset.click();
  expect(h.timers.size).toBe(0);
  expect(h.replacementReset).toBe(0);
  expect(h.panel.inert).toBe(false);
  expect(h.panel.classList.contains('is-dev-overlay-open')).toBe(true);
  expect(h.cropActive).toBe(true);
  expect(h.collapseSets.at(-1)).toEqual([false, undefined]);
});

test('disconnect aborts handlers, clears timers, and destroys all controllers', () => {
  const h = setup();
  h.hide.click();
  expect(h.timers.size).toBe(1);
  h.demo.remove();
  expect(h.timers.size).toBe(0);
  expect(h.collapseDestroyed).toBe(1);
  expect(h.replacementDestroyed).toBe(1);
  expect(h.cropDestroyed).toBe(1);
  expect(h.errors).toEqual([]);
  const before = h.replacementReset;
  h.reset.click();
  expect(h.replacementReset).toBe(before);
});

test('viewport selector forwards choices and keeps one active state', () => {
  const h = setup();
  const tablet = h.demo.querySelector('[data-crop-viewport="tablet"]') as HTMLButtonElement;
  tablet.click();
  expect(h.selectedViewport).toBe('tablet');
  expect(tablet.getAttribute('aria-pressed')).toBe('true');
});

test('repeated iframe readiness does not recreate the same host crop', () => {
  const h = setup();
  expect(h.cropCreated).toBe(1);
  h.frame.dispatchEvent(new h.win.Event('load'));
  expect(h.cropCreated).toBe(1);
  expect(h.errors).toEqual([]);
});
