import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { normalizeImageVariants, responsiveImageStyle, coverWidthFraction } from '../../src/lib/responsiveImage';
import { createImageCropStage, cropResizeHeight } from '../../src/lib/imageCropStage';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/demos/CropFrameDemo.astro', import.meta.url), 'utf8')
  .split('<script>')[1].split('</script>')[0].replace(/^\s*import .*?;\s*$/gm, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<vcd-crop-frame-demo>
    <select class="dev-select__native"><option value="4:3">4:3</option><option value="1:1">1:1</option><option value="3:4">3:4</option></select>
    <button data-crop-reset>Reset</button>
    <div class="project-image"><div class="project-crop-clip"><img src="/example.jpg"></div></div>
  </vcd-crop-frame-demo>`;
  const env = { HTMLElement: win.HTMLElement, customElements: win.customElements, Event: win.Event, AbortController: win.AbortController, coverWidthFraction, normalizeImageVariants, responsiveImageStyle, createImageCropStage, cropResizeHeight };
  new Function('env', `with (env) { ${compiled} }`)(env);
  const host = document.querySelector('.project-image') as HTMLElement;
  const stage = document.querySelector('.dev-crop-stage') as HTMLElement;
  stage.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 } as DOMRect);
  const captures = new Set<number>();
  stage.setPointerCapture = (id: number) => captures.add(id);
  stage.releasePointerCapture = (id: number) => captures.delete(id);
  stage.hasPointerCapture = (id: number) => captures.has(id);
  const select = document.querySelector('select') as HTMLSelectElement;
  const changes: string[] = [];
  select.addEventListener('change', () => changes.push(select.value));
  const pointer = (target: Element, type: string, values: Record<string, number>) => {
    const event = new win.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 4, clientX: 200, clientY: 150 }, values);
    target.dispatchEvent(event);
  };
  return { win, document, host, stage, select, changes, captures, pointer, reset: document.querySelector('[data-crop-reset]') as HTMLButtonElement };
}

test('shared crop stage mounts eight handles; reset restores native selector and framing', () => {
  const h = setup();
  expect(h.stage.querySelectorAll('[data-page-resize]').length).toBe(8);
  h.select.value = '3:4';
  h.select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  h.reset.click();
  expect(h.select.value).toBe('4:3');
  expect(h.changes.at(-1)).toBe('4:3');
  expect(h.host.dataset.cropAspect).toBe('4:3');
  expect(Number(h.host.style.getPropertyValue('--project-content-w-desktop'))).toBeCloseTo(0.8);
});

test('pan uses measured stage geometry and releases pointer capture on cancellation', () => {
  const h = setup();
  h.pointer(h.stage, 'pointerdown', {});
  h.pointer(h.stage, 'pointermove', { clientX: 220, clientY: 150 });
  expect(Number(h.host.style.getPropertyValue('--project-content-cx-desktop'))).toBeCloseTo(0.46);
  h.pointer(h.stage, 'pointermove', { clientX: -5000, clientY: 5000 });
  expect(Number(h.host.style.getPropertyValue('--project-content-cx-desktop'))).toBeCloseTo(0.6);
  expect(Number(h.host.style.getPropertyValue('--project-content-cy-desktop'))).toBeCloseTo(0.4);
  h.pointer(h.stage, 'pointercancel', {});
  expect(h.stage.classList.contains('is-dragging')).toBe(false);
  expect(h.captures.size).toBe(0);
});

test('successive resize moves stay relative to the initial pointer and sync the selector', () => {
  const h = setup();
  const south = h.stage.querySelector('[data-page-resize="s"]')!;
  h.pointer(south, 'pointerdown', {});
  h.pointer(h.stage, 'pointermove', { clientY: 170 });
  expect(h.host.dataset.cropAspect).toBe('400:320');
  h.pointer(h.stage, 'pointermove', { clientY: 190 });
  expect(h.host.dataset.cropAspect).toBe('400:340');
  h.pointer(h.stage, 'pointerup', { clientY: 190 });
  expect(h.select.value).toBe('400:340');
  h.reset.click();
  expect(h.select.querySelector('[data-crop-custom]')).toBeNull();
});

test('wheel zoom changes scale; disconnect removes stage and listeners', () => {
  const h = setup();
  const event = new h.win.Event('wheel', { cancelable: true });
  Object.assign(event, { ctrlKey: true, deltaY: -60, deltaX: 0, clientX: 200, clientY: 150 });
  h.stage.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(Number(h.host.style.getPropertyValue('--project-content-w-desktop'))).toBeLessThan(0.8);
  const demo = h.document.querySelector('vcd-crop-frame-demo')!;
  demo.remove();
  expect(h.host.querySelector('.dev-crop-stage')).toBeNull();
  expect(h.host.querySelector('.dev-crop-ghost')).toBeNull();
});

test('shared resize math handles both edge axes, corners and ratio bounds', () => {
  expect(cropResizeHeight('e', 400, 300, 100, 0)).toBe(240);
  expect(cropResizeHeight('w', 400, 300, -100, 0)).toBe(240);
  expect(cropResizeHeight('ne', 400, 300, 100, 40)).toBe(260);
  expect(cropResizeHeight('s', 400, 300, 0, -500)).toBe(80);
});
