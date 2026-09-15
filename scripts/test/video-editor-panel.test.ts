import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { normalizeImageVariants, responsiveImageStyle, coverWidthFraction } from '../../src/lib/responsiveImage';
import { imageSourceDims } from '../../src/lib/projectImageFrame';
const projectStyles = readFileSync(new URL('../../src/styles/project.css', import.meta.url)).toString();

const source = readFileSync(new URL('../../src/components/DevVideoEditor.astro', import.meta.url))
  .toString().split('<script>')[1].split('</script>')[0]
  .replace(/^\s*import .*?;\s*$/gm, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `
    <div data-dev-panel-key="video" hidden>
      <div data-dev-video-editor>
        <button data-video-viewport="desktop"></button><button data-video-viewport="tablet"></button><button data-video-viewport="mobile"></button>
        <select data-video-aspect><option value="original">Original</option><option value="1:1">1:1</option></select>
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
    normalizeImageVariants, responsiveImageStyle, imageSourceDims,
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
  expect(JSON.parse(h.target.dataset.devImageVariants!).desktop.w).toBeCloseTo(0.5625);
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
  expect(h.pending.at(-1).payload.variants.desktop.w).toBeCloseTo(0.5625);
  h.history[0].undo();
  expect(h.pending.at(-1).payload.variants.desktop.w).toBe(1);
  h.history[0].redo();
  expect(h.pending.at(-1).payload.variants.desktop.w).toBeCloseTo(0.5625);
});

test('cropped inline videos use the project source crop rectangle', () => {
  expect(projectStyles).toContain('.project-cropped > video[data-project-inline-video]');
  expect(projectStyles).toContain('width: calc(100% / var(--project-content-w, 1));');
  expect(projectStyles).toContain('transform: translate(');
  expect(projectStyles).not.toContain('object-fit: contain !important');
});
