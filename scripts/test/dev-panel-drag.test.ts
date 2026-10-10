import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDevPanelDrag } from '../../src/lib/devPanelDrag';

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  Object.defineProperty(win, 'innerWidth', { configurable: true, value: 400 });
  Object.defineProperty(win, 'innerHeight', { configurable: true, value: 300 });
  win.document.body.innerHTML = '<section data-dev-panel-draggable><header data-drag-handle><span></span></header></section>';
  const panel = win.document.querySelector('section') as HTMLElement;
  const handle = panel.querySelector('[data-drag-handle]') as HTMLElement;
  Object.defineProperties(panel, {
    offsetWidth: { configurable: true, value: 120 },
    offsetHeight: { configurable: true, value: 80 },
  });
  Object.defineProperty(panel, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const left = panel.style.left ? Number.parseFloat(panel.style.left) : 40; const top = panel.style.top ? Number.parseFloat(panel.style.top) : 30; return ({ left, top, width: 120, height: 80, right: left + 120, bottom: top + 80 }); },
  });
  handle.setPointerCapture = () => {};
  handle.releasePointerCapture = () => {};
  handle.hasPointerCapture = () => true;
  return { win, panel, handle };
}

function pointer(win: Window, type: string, values: Partial<PointerEvent> = {}) {
  const event = new win.Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    button: { value: values.button ?? 0 },
    isPrimary: { value: values.isPrimary ?? true },
    pointerId: { value: values.pointerId ?? 1 },
    clientX: { value: values.clientX ?? 0 },
    clientY: { value: values.clientY ?? 0 },
  });
  return event;
}

test('drag accepts foreign-realm targets and clamps the committed position to the viewport', () => {
  const h = setup();
  const cleanup = createDevPanelDrag(h.panel);
  const foreign = new Window().document.createElement('span');
  h.handle.append(foreign);
  foreign.dispatchEvent(pointer(h.win, 'pointerdown', { clientX: 40, clientY: 30 }));
  h.handle.dispatchEvent(pointer(h.win, 'pointermove', { clientX: 500, clientY: 500 }));
  h.handle.dispatchEvent(pointer(h.win, 'pointerup', { clientX: 500, clientY: 500 }));
  expect(h.panel.style.left).toBe('280px');
  expect(h.panel.style.top).toBe('220px');
  expect(h.panel.classList.contains('is-dragging')).toBe(false);
  cleanup();
});

test('pointer cancellation commits the pending position and teardown clears the init marker', () => {
  const h = setup();
  const cleanup = createDevPanelDrag(h.panel);
  h.handle.dispatchEvent(pointer(h.win, 'pointerdown', { clientX: 40, clientY: 30 }));
  h.handle.dispatchEvent(pointer(h.win, 'pointermove', { clientX: 90, clientY: 70 }));
  h.handle.dispatchEvent(pointer(h.win, 'pointercancel', { clientX: 90, clientY: 70 }));
  expect(h.panel.classList.contains('is-dragging')).toBe(false);
  expect(h.panel.style.left).toBe('90px');
  expect(h.panel.style.top).toBe('70px');
  expect(h.panel.dataset.devPanelDragInitialized).toBe('true');
  cleanup();
  expect(h.panel.dataset.devPanelDragInitialized).toBeUndefined();
});

test('foreign-created drag-ignore controls are ignored without preventing default', () => {
  const h = setup();
  const foreign = new Window();
  const panel = foreign.document.createElement('section');
  const handle = foreign.document.createElement('header');
  const button = foreign.document.createElement('button');
  handle.dataset.dragHandle = '';
  button.dataset.dragIgnore = '';
  handle.append(button);
  panel.append(handle);
  foreign.document.body.append(panel);
  h.win.document.body.append(panel);
  Object.defineProperties(panel, {
    offsetWidth: { configurable: true, value: 120 },
    offsetHeight: { configurable: true, value: 80 },
  });
  Object.defineProperty(panel, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const left = panel.style.left ? Number.parseFloat(panel.style.left) : 40; const top = panel.style.top ? Number.parseFloat(panel.style.top) : 30; return ({ left, top, width: 120, height: 80, right: left + 120, bottom: top + 80 }); },
  });
  handle.setPointerCapture = () => {};
  handle.releasePointerCapture = () => {};
  handle.hasPointerCapture = () => false;
  const cleanup = createDevPanelDrag(panel);
  const event = pointer(h.win, 'pointerdown', { clientX: 40, clientY: 30 });
  button.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(panel.classList.contains('is-dragging')).toBe(false);
  cleanup();
});

test('absolute panels preserve a nonzero containing origin on grab, move, release, and reclamp', () => {
  const h = setup();
  const origin = { left: 60, top: 40 };
  h.panel.style.left = '100px';
  h.panel.style.top = '50px';
  Object.defineProperty(h.panel, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const left = origin.left + (h.panel.style.left ? Number.parseFloat(h.panel.style.left) : 0); const top = origin.top + (h.panel.style.top ? Number.parseFloat(h.panel.style.top) : 0); return ({ left, top, width: 120, height: 80, right: left + 120, bottom: top + 80 }); },
  });
  const cleanup = createDevPanelDrag(h.panel);
  h.handle.dispatchEvent(pointer(h.win, 'pointerdown', { clientX: 160, clientY: 90 }));
  expect(h.panel.style.left).toBe('100px');
  h.handle.dispatchEvent(pointer(h.win, 'pointermove', { clientX: 210, clientY: 120 }));
  h.handle.dispatchEvent(pointer(h.win, 'pointerup', { clientX: 210, clientY: 120 }));
  expect(h.panel.style.left).toBe('150px');
  expect(h.panel.style.top).toBe('80px');
  h.panel.style.left = '400px';
  h.win.dispatchEvent(new h.win.Event('resize'));
  expect(h.panel.style.left).toBe('220px');
  cleanup();
});
