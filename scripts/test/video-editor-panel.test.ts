import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { normalizeImageVariants, responsiveImageStyle, coverWidthFraction } from '../../src/lib/responsiveImage';
import { imageSourceDims } from '../../src/lib/projectImageFrame';
import { imageVariantsSavePayload, resetImageVariantSetting, setImageVariantSetting } from '../../src/lib/imageVariantInheritance';
const projectStyles = readFileSync(new URL('../../src/styles/project.css', import.meta.url)).toString();

const source = readFileSync(new URL('../../src/components/DevVideoEditor.astro', import.meta.url))
  .toString().split('<script>')[1].split('</script>')[0]
  .replace(/^\s*import .*?;\s*$/gm, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

function setup(initialVariants: Record<string, unknown> = {}) {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `
    <div data-dev-panel-key="video" hidden>
      <div data-dev-video-editor>
        <button data-video-viewport="desktop"></button><button data-video-viewport="tablet"></button><button data-video-viewport="mobile"></button>
        <select data-video-aspect><option value="original">Original</option><option value="1:1">1:1</option><option value="2:3">2:3</option><option value="16:9">16:9</option></select><button data-video-aspect-reset></button>
        <button data-video-audio="false"></button><button data-video-audio="true"></button>
        <div data-video-preview-wrap><video data-video-preview></video></div>
        <output data-video-zoom-readout></output><input data-video-zoom type="range" min="0.1" max="1" value="1">
        <div data-video-replace-drop><button data-video-replace-choose></button><input data-video-replace-file type="file"></div>
        <button data-video-cancel></button><button data-video-reset></button><button data-video-save></button><p data-video-status></p>
      </div>
    </div>
    <div data-dev-panel-key="image"></div>
    <figure class="dev-image-edit-target" data-dev-image-target data-dev-document="test" data-dev-image-path="[&quot;sections&quot;,0]" data-dev-image-src="demo.mp4" data-dev-image-src-width="1920" data-dev-image-src-height="1080"><video></video></figure>`;
  const target = document.querySelector('[data-dev-image-target]') as HTMLElement;
  if (Object.keys(initialVariants).length) target.dataset.devImageVariants = JSON.stringify(initialVariants);
  const preview = document.querySelector('[data-video-preview]') as HTMLVideoElement;
  Object.defineProperty(preview, 'videoWidth', { configurable: true, value: 1920 });
  Object.defineProperty(preview, 'videoHeight', { configurable: true, value: 1080 });
  const pending: any[] = [];
  const history: any[] = [];
  const env: any = {
    window: win, document, CustomEvent: win.CustomEvent, AbortController: win.AbortController,
    devEditPendingId: () => 'crop:test', withDevEditTarget: (value: any) => value,
    projectImage: (value: string) => value, isVideoSrc: (value: string) => /\.(mp4|webm|m4v)$/i.test(value),
    isAcceptedVideoFile: () => true,
    resolveVideoAudio: (value: any) => {
      const input = value && typeof value === 'object' ? value : {};
      let previous = true;
      return ['desktop', 'tablet', 'mobile'].reduce((out: any, viewport) => {
        out[viewport] = typeof input[viewport] === 'boolean' ? input[viewport] : previous;
        previous = out[viewport];
        return out;
      }, {});
    },
    normalizeImageVariants, responsiveImageStyle, coverWidthFraction, imageSourceDims,
    imageVariantsSavePayload, resetImageVariantSetting, setImageVariantSetting,
    coverWidthFraction,
    pageHistory: { push: (entry: any) => history.push(entry) },
  };
  new Function('env', `with (env) { ${compiled} }`)(env);
  win.addEventListener('vcd:dev-pending-upsert', (event: any) => pending.push(event.detail));
  const open = () => win.dispatchEvent(new win.CustomEvent('vcd:dev-edit-open', {
    detail: { panel: document.querySelector('[data-dev-panel-key="image"]'), trigger: target },
  }));
  return { win, document, target, pending, history, open };
}

test('opening a video applies shared crop geometry and cancel restores the target', () => {
  const h = setup();
  const baseline = { className: h.target.className, style: h.target.getAttribute('style'), variants: h.target.dataset.devImageVariants };
  h.open();
  expect(h.document.querySelector('[data-dev-panel-key="video"]')?.hidden).toBe(false);
  expect(h.target.classList.contains('project-cropped')).toBe(true);
  const aspect = h.document.querySelector('[data-video-aspect]') as HTMLSelectElement;
  aspect.value = '1:1';
  aspect.dispatchEvent(new h.win.Event('change'));
  expect(JSON.parse(h.target.dataset.devImageVariants!).desktop.w).toBeUndefined();
  const preview = h.document.querySelector('[data-video-preview]') as HTMLVideoElement;
  Object.defineProperty(preview, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(preview, 'clientHeight', { configurable: true, value: 100 });
  const down = new h.win.Event('pointerdown') as any;
  Object.assign(down, { button: 0, pointerId: 7, clientX: 50, clientY: 50 });
  preview.setPointerCapture = () => {};
  preview.dispatchEvent(down);
  const move = new h.win.Event('pointermove') as any;
  Object.assign(move, { pointerId: 7, clientX: 60, clientY: 50 });
  preview.dispatchEvent(move);
  expect(JSON.parse(h.target.dataset.devImageVariants!).desktop.cx).toBeLessThan(0.5);
  const firstX = JSON.parse(h.target.dataset.devImageVariants!).desktop.cx;
  Object.assign(move, { clientX: 65 });
  preview.dispatchEvent(move);
  expect(JSON.parse(h.target.dataset.devImageVariants!).desktop.cx).toBeLessThan(firstX);
  (h.document.querySelector('[data-video-cancel]') as HTMLButtonElement).click();
  expect(h.target.className).toBe(baseline.className);
  expect(h.target.getAttribute('style')).toBe(baseline.style);
  expect(h.target.dataset.devImageVariants).toBe(baseline.variants);
});

test('save history updates the pending crop payload on undo and redo', () => {
  const h = setup();
  h.open();
  const aspect = h.document.querySelector('[data-video-aspect]') as HTMLSelectElement;
  aspect.value = '1:1';
  aspect.dispatchEvent(new h.win.Event('change'));
  (h.document.querySelector('[data-video-save]') as HTMLButtonElement).click();
  expect(h.pending.at(-1).payload.variants.desktop.w).toBeUndefined();
  h.history[0].undo();
  expect(h.pending.at(-1).payload.variants).toEqual({ desktop: {}, tablet: {}, mobile: {} });
  h.history[0].redo();
  expect(h.pending.at(-1).payload.variants.desktop.w).toBeUndefined();
});

test('desktop aspect edits cascade while explicit mobile overrides survive until reset', () => {
  const h = setup({ mobile: { aspect: '2:3' } });
  h.open();
  const aspect = h.document.querySelector('[data-video-aspect]') as HTMLSelectElement;
  aspect.value = '1:1';
  aspect.dispatchEvent(new h.win.Event('change'));
  (h.document.querySelector('[data-video-viewport="tablet"]') as HTMLButtonElement).click();
  expect(aspect.value).toBe('1:1');
  (h.document.querySelector('[data-video-viewport="mobile"]') as HTMLButtonElement).click();
  expect(aspect.value).toBe('2:3');
  (h.document.querySelector('[data-video-save]') as HTMLButtonElement).click();
  expect(h.pending.at(-1).payload.variants).toEqual({ desktop: { aspect: '1:1', cx: 0.5, cy: 0.5 }, tablet: {}, mobile: { aspect: '2:3' } });
  h.open();
  (h.document.querySelector('[data-video-viewport="mobile"]') as HTMLButtonElement).click();
  expect(aspect.value).toBe('2:3');
  (h.document.querySelector('[data-video-aspect-reset]') as HTMLButtonElement).click();
  expect(aspect.value).toBe('1:1');
  h.win.dispatchEvent(new h.win.CustomEvent('vcd:dev-before-save'));
  expect(h.pending.at(-1).payload.variants.mobile).toEqual({});
});

test('dragging an inherited mobile crop saves pan without a zoom width', () => {
  const h = setup();
  h.open();
  const aspect = h.document.querySelector('[data-video-aspect]') as HTMLSelectElement;
  aspect.value = '1:1';
  aspect.dispatchEvent(new h.win.Event('change'));
  (h.document.querySelector('[data-video-viewport="mobile"]') as HTMLButtonElement).click();
  const preview = h.document.querySelector('[data-video-preview]') as HTMLVideoElement;
  Object.defineProperty(preview, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(preview, 'clientHeight', { configurable: true, value: 100 });
  preview.setPointerCapture = () => {};
  const down = new h.win.Event('pointerdown') as any;
  Object.assign(down, { button: 0, pointerId: 9, clientX: 50, clientY: 50 });
  preview.dispatchEvent(down);
  const move = new h.win.Event('pointermove') as any;
  Object.assign(move, { pointerId: 9, clientX: 55, clientY: 50 });
  preview.dispatchEvent(move);
  (h.document.querySelector('[data-video-save]') as HTMLButtonElement).click();
  expect(h.pending.at(-1).payload.variants.mobile.w).toBeUndefined();
  expect(h.pending.at(-1).payload.variants.mobile.cx).toBeLessThan(0.5);
});

test('existing zoom settings are cleaned for fill while cancel restores the raw payload', () => {
  const initial = { desktop: { aspect: '1:1', w: 0.3, cx: 0.1, cy: 0.5, zoom: 0.3 } };
  const h = setup(initial);
  h.open();
  const resolved = JSON.parse(h.target.dataset.devImageVariants!);
  expect(resolved.desktop.w).toBeUndefined();
  expect(resolved.desktop.cx).toBeGreaterThanOrEqual(0.28125);
  (h.document.querySelector('[data-video-save]') as HTMLButtonElement).click();
  expect(h.pending.at(-1).payload.variants.desktop.w).toBeUndefined();
  expect(h.pending.at(-1).payload.variants.desktop.zoom).toBeUndefined();

  const cancelled = setup(initial);
  cancelled.open();
  (cancelled.document.querySelector('[data-video-cancel]') as HTMLButtonElement).click();
  expect(cancelled.target.dataset.devImageVariants).toBe(JSON.stringify(initial));
});

test('inherited pan is clamped when a smaller breakpoint changes aspect', () => {
  const h = setup({ desktop: { aspect: '1:1', cx: 0.3, cy: 0.5 }, mobile: { aspect: '16:9' } });
  h.open();
  (h.document.querySelector('[data-video-save]') as HTMLButtonElement).click();
  expect(h.pending.at(-1).payload.variants.mobile).toEqual({ aspect: '16:9', cx: 0.5 });
});

test('cropped inline videos use the project source crop rectangle', () => {
  expect(projectStyles).toContain('.project-cropped > video[data-project-inline-video]');
  expect(projectStyles).toContain('width: calc(100% / var(--project-content-w, 1));');
  expect(projectStyles).toContain('transform: translate(');
  expect(projectStyles).not.toContain('object-fit: contain !important');
  expect(projectStyles).toContain('.project-image-grid__item .project-image-grid__frame > .project-video-player__controller > video[data-project-inline-video]');
  expect(projectStyles).not.toContain('width: calc(100% + 2px);\n    max-width: none;\n    height: calc(100% + 2px);');
});
