import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { normalizeImageVariants, responsiveImageStyle, coverWidthFraction } from '../../src/lib/responsiveImage';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/demos/CropFrameDemo.astro', import.meta.url))
  .toString().split('<script>')[1].split('</script>')[0]
  .replace(/^\s*import .*?;\s*$/gm, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<vcd-crop-frame-demo>
    <div class="crop-frame-demo__toolbar"><div class="dev-field"><select class="dev-select__native"><option value="4:3">4:3</option><option value="1:1">1:1</option><option value="3:4">3:4</option></select><button class="dev-select__trigger"><span data-dev-select-label>4:3</span></button></div><input data-crop-zoom type="range" min="100" max="250" step="1" value="125"><button data-crop-reset>Reset</button></div>
    <div class="crop-frame-demo__frame" data-crop-frame></div>
  </vcd-crop-frame-demo>`;
  const host = document.querySelector('[data-crop-frame]') as HTMLElement;
  host.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 } as DOMRect);
  const captures = new Set<number>();
  host.setPointerCapture = (id: number) => captures.add(id);
  host.releasePointerCapture = (id: number) => captures.delete(id);
  host.hasPointerCapture = (id: number) => captures.has(id);
  const select = document.querySelector('select') as HTMLSelectElement;
  const trigger = document.querySelector('[data-dev-select-label]') as HTMLElement;
  const changes: string[] = [];
  select.addEventListener('change', () => { changes.push(select.value); trigger.textContent = select.value; });
  const env = { HTMLElement: win.HTMLElement, customElements: win.customElements, document, Event: win.Event, AbortController: win.AbortController, coverWidthFraction, normalizeImageVariants, responsiveImageStyle };
  new Function('env', `with (env) { ${compiled} }`)(env);
  return { win, document, host, select, trigger, changes, reset: document.querySelector('[data-crop-reset]') as HTMLButtonElement };
}

function pointer(win: Window, type: string, values: Record<string, number>) {
  const event = new win.Event(type) as Event & Record<string, number>;
  Object.assign(event, values);
  return event;
}

test('reset restores the native frame and emits the binding change event', () => {
  const h = setup();
  h.select.value = '3:4';
  h.select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  expect(h.trigger.textContent).toBe('3:4');
  h.reset.click();
  expect(h.select.value).toBe('4:3');
  expect(h.changes.at(-1)).toBe('4:3');
  expect(h.trigger.textContent).toBe('4:3');
  expect((h.document.querySelector('[data-crop-zoom]') as HTMLInputElement).value).toBe('125');
  expect(h.host.dataset.cropAspect).toBe('4:3');
});

test('pointer cancel clears drag state and pan stays clamped', () => {
  const h = setup();
  h.select.value = '1:1';
  h.select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  const zoom = h.document.querySelector('[data-crop-zoom]') as HTMLInputElement;
  zoom.value = '200';
  zoom.dispatchEvent(new h.win.Event('input', { bubbles: true }));
  const initialCx = h.host.style.getPropertyValue('--project-content-cx-desktop');
  const initialCy = h.host.style.getPropertyValue('--project-content-cy-desktop');
  expect(initialCx).not.toBe('');
  expect(initialCy).not.toBe('');
  h.host.dispatchEvent(pointer(h.win, 'pointerdown', { button: 0, pointerId: 4, clientX: 200, clientY: 150 }));
  h.host.dispatchEvent(pointer(h.win, 'pointermove', { pointerId: 4, clientX: -5000, clientY: 5000 }));
  const cx = Number(h.host.style.getPropertyValue('--project-content-cx-desktop'));
  const cy = Number(h.host.style.getPropertyValue('--project-content-cy-desktop'));
  expect(Number(h.host.style.getPropertyValue('--project-content-w-desktop'))).toBeCloseTo(0.375);
  expect(cx).toBeCloseTo(0.8125);
  expect(cy).toBeCloseTo(0.25);
  h.host.dispatchEvent(pointer(h.win, 'pointercancel', { pointerId: 4 }));
  expect(h.host.classList.contains('is-dragging')).toBe(false);
  h.reset.click();
  expect(h.host.classList.contains('is-active')).toBe(false);
});
