import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createHistory, pageHistory, registerHistoryScope } from '../../src/lib/devHistory';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';
import { devEditPendingId } from '../../src/scripts/devEditTarget';
import { imageGridConstrainedStyle, resolveImageGridConstrained } from '../../src/lib/responsiveImage';
import { applyCarouselViewportSettings } from '../../src/lib/projectImageCarousel';
import {
  IMAGE_VIEWPORTS,
  matchCarouselViewport,
  resolveCarouselSettings,
  serializeCarouselSettings,
} from '../../src/lib/projectImageCarouselSettings';

const componentScript = (path: string) => {
  const source = readFileSync(path, 'utf8');
  const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/import\s+['"][^'"]+['"];?/g, '')
    .replace(/import\.meta\.hot\?\.dispose\(disposePage\);/g, 'return disposePage;');
  return new Bun.Transpiler({ loader: 'ts' }).transformSync(script);
};

const sourcePath = (file: string) => process.env.MEDIA_TUNER_SOURCE_ROOT
  ? `${process.env.MEDIA_TUNER_SOURCE_ROOT}/${file}`
  : new URL(`../../src/components/project/${file}`, import.meta.url).pathname;

const globalsFor = (window: Window) => ({
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});

const withWindow = async (run: (window: Window) => Promise<void>) => {
  const window = new Window({ url: 'http://localhost:4322/goodhome' });
  const globals = globalsFor(window);
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }));
  try {
    await run(window);
  } finally {
    previous.forEach((descriptor, key) => descriptor
      ? Object.defineProperty(globalThis, key, descriptor)
      : Reflect.deleteProperty(globalThis, key));
    await window.happyDOM.close();
    pageHistory.clear();
  }
};

const env = {
  createHistory,
  pageHistory,
  registerHistoryScope,
  createPageScope,
  onPageLoad,
  devEditPendingId,
  plusIcon: '<svg></svg>',
  imageGridConstrainedStyle,
  resolveImageGridConstrained,
  applyCarouselViewportSettings: () => {},
  IMAGE_VIEWPORTS,
  matchCarouselViewport,
  resolveCarouselSettings,
  serializeCarouselSettings,
  sizeIcon: (value: string) => value,
  refreshProjectCropCovers: () => {},
};

const mount = (window: Window, kind: 'grid' | 'carousel') => {
  const targetAttr = kind === 'grid' ? 'data-dev-grid-target' : 'data-dev-carousel-target';
  const panelKey = kind;
  const targetData = kind === 'grid'
    ? `data-dev-grid-columns='{"desktop":2,"tablet":2,"mobile":2}' data-dev-grid-items='[]' data-dev-grid-layouts='{}' data-dev-grid-default-aspect='4:3' data-dev-document='projects/goodhome' data-dev-grid-path='["sections",0]'`
    : `data-dev-carousel-items='[]' data-dev-carousel-settings='{"orientation":"horizontal","visible":[]}' data-dev-document='projects/goodhome' data-dev-carousel-path='["sections",1]'`;
  const controls = kind === 'grid'
    ? `<select data-grid-columns><option value="2">2</option><option value="3">3</option></select>
      <select data-grid-constrained><option value="100">100</option></select>
      <select data-grid-aspect-ratio><option value="4:3">4:3</option></select>
      <input data-grid-match-height type="checkbox">
      <div data-grid-visible></div><div data-grid-parking><span data-grid-parking-hint></span></div>
      <p data-grid-inherit></p><button data-grid-viewport="desktop"></button>
      <button data-grid-viewport="tablet"></button><button data-grid-viewport="mobile"></button>
      <button data-grid-cancel></button><button data-grid-revert></button>
      <button data-grid-clear-override></button><button data-grid-save></button><p data-grid-status></p>`
    : `<button data-carousel-orientation="horizontal"></button><button data-carousel-orientation="vertical"></button>
      <button data-carousel-viewport="desktop"></button><button data-carousel-viewport="tablet"></button><button data-carousel-viewport="mobile"></button>
      <p data-carousel-inherit></p><select data-carousel-constrained><option value="100">100</option></select>
      <select data-carousel-height-mode><option value="dynamic">dynamic</option></select>
      <select data-carousel-max-vh><option value="">none</option></select>
      <input data-carousel-scroll-pinned type="checkbox"><select data-carousel-dots-placement><option value="outside">outside</option></select>
      <div data-carousel-visible></div><div data-carousel-parking><span data-carousel-parking-hint></span></div>
      <button data-carousel-clear-override></button><button data-carousel-cancel></button><button data-carousel-revert></button>
      <button data-carousel-save></button><p data-carousel-status></p>`;
  window.document.body.innerHTML = `<main id="main-content"><div ${targetAttr} ${targetData}><button data-dev-edit-trigger="${kind}"></button></div>
    <div data-dev-panel-key="${panelKey}" hidden><div data-project-image-${kind}-tuner>${controls}</div></div></main>`;
  return {
    target: window.document.querySelector<HTMLElement>(`[${targetAttr}]`)!,
    tuner: window.document.querySelector<HTMLElement>(`[data-project-image-${kind}-tuner]`)!,
  };
};

const runTunerLifecycle = async (kind: 'grid' | 'carousel', path: string) => withWindow(async (window) => {
  window.document.documentElement.classList.add('is-dev-mode');
  const pending: any[] = [];
  window.addEventListener('vcd:dev-pending-upsert', (event: any) => pending.push(event.detail));
  let current = mount(window, kind);
  const dispose = new Function(...Object.keys(env), componentScript(path))(...Object.values(env)) as () => void;
  const staleSaves: HTMLButtonElement[] = [];
  try {
    for (let page = 0; page < 3; page += 1) {
      if (page) {
        window.document.dispatchEvent(new window.Event('astro:before-swap'));
        staleSaves.push(current.tuner.querySelector<HTMLButtonElement>(`[data-${kind}-save]`)!);
        current = mount(window, kind);
        window.document.dispatchEvent(new window.Event('astro:page-load'));
        window.document.dispatchEvent(new window.Event('astro:page-load'));
      }
      const trigger = current.target.querySelector<HTMLButtonElement>('[data-dev-edit-trigger]')!;
      window.dispatchEvent(new window.CustomEvent('vcd:dev-edit-open', { detail: { trigger } }));
      if (kind === 'grid') {
        const columns = current.tuner.querySelector<HTMLSelectElement>('[data-grid-columns]')!;
        columns.value = '3';
        columns.dispatchEvent(new window.Event('change', { bubbles: true }));
        expect(JSON.parse(current.target.dataset.devGridColumns!).desktop).toBe(3);
      } else {
        current.tuner.querySelector<HTMLButtonElement>('[data-carousel-orientation="vertical"]')!.click();
        expect(JSON.parse(current.target.dataset.devCarouselSettings!).orientation).toBe('vertical');
      }
      current.tuner.querySelector<HTMLButtonElement>(`[data-${kind}-save]`)!.click();
      expect(pending).toHaveLength(page + 1);
      expect(pending.at(-1).payload.document).toBe('projects/goodhome');
      expect(pending.at(-1).payload.path).toEqual(['sections', page === 0 ? (kind === 'grid' ? 0 : 1) : (kind === 'grid' ? 0 : 1)]);
      if (kind === 'grid') expect(pending.at(-1).payload.columns.desktop).toBe(3);
      else expect(pending.at(-1).payload.orientation).toBe('vertical');
      staleSaves.forEach((button) => button.click());
      expect(pending).toHaveLength(page + 1);
    }
  } finally {
    dispose?.();
  }
});

test('grid tuner survives repeated page replacements and detaches old Save handlers', async () => {
  await runTunerLifecycle('grid', sourcePath('ProjectImageGridTuner.astro'));
});

test('carousel tuner survives repeated page replacements and detaches old Save handlers', async () => {
  await runTunerLifecycle('carousel', sourcePath('ProjectImageCarouselTuner.astro'));
});
