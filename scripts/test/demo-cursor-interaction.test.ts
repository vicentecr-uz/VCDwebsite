import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoCursorInteraction } from '../../src/lib/demoCursorInteraction';

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const root = win.document.createElement('div');
  const button = win.document.createElement('button');
  const child = win.document.createElement('span');
  button.append(child); root.append(button); win.document.body.append(root);
  let hit: Element | null = child;
  Object.defineProperty(win.document, 'elementFromPoint', { value: () => hit, configurable: true });
  Object.defineProperty(win, 'getComputedStyle', { value: (element: Element) => ({ cursor: element === child || element === button ? 'pointer' : 'default' }), configurable: true });
  return { win, root, button, child, setHit: (next: Element | null) => { hit = next; } };
}

test('marks the nearest enabled control and maps its cursor immediately', () => {
  const h = setup();
  const interaction = createDemoCursorInteraction({ root: h.root });
  expect(interaction.update({ x: 10, y: 10 })).toBe('pointer');
  expect(h.button.getAttribute('data-demo-hover')).toBe('true');
  interaction.destroy();
});

test('press and release markers follow the hovered control', () => {
  const h = setup();
  const interaction = createDemoCursorInteraction({ root: h.root });
  interaction.update({ x: 10, y: 10 }); interaction.press();
  expect(h.button.getAttribute('data-demo-pressed')).toBe('true');
  interaction.release();
  expect(h.button.hasAttribute('data-demo-pressed')).toBe(false);
  interaction.destroy();
});

test('moving away clears hover and pressed state, including hidden updates', () => {
  const h = setup();
  const interaction = createDemoCursorInteraction({ root: h.root });
  interaction.update({ x: 10, y: 10 }); interaction.press(); h.setHit(null);
  expect(interaction.update({ x: 30, y: 30 })).toBe('arrow');
  expect(h.button.hasAttribute('data-demo-hover')).toBe(false);
  expect(h.button.hasAttribute('data-demo-pressed')).toBe(false);
  h.setHit(h.child); interaction.update({ x: 10, y: 10 }); interaction.press();
  interaction.update({ x: 10, y: 10 }, false); h.setHit(h.child); interaction.update({ x: 10, y: 10 });
  expect(h.button.hasAttribute('data-demo-pressed')).toBe(false);
  interaction.destroy();
});

test('disabled controls are excluded from hover and pointer mode', () => {
  const h = setup();
  h.button.disabled = true;
  const interaction = createDemoCursorInteraction({ root: h.root });
  expect(interaction.update({ x: 10, y: 10 })).toBe('arrow');
  expect(h.button.hasAttribute('data-demo-hover')).toBe(false);
  interaction.destroy();
});

test('maps a child iframe hit using its displayed scale', () => {
  const parent = new Window({ url: 'http://localhost/' });
  const child = new Window({ url: 'http://child.local/' });
  const root = parent.document.createElement('div');
  const iframe = parent.document.createElement('iframe');
  const button = child.document.createElement('button');
  child.document.body.append(button); root.append(iframe); parent.document.body.append(root);
  Object.defineProperty(iframe, 'contentDocument', { value: child.document });
  Object.defineProperty(iframe, 'contentWindow', { value: child });
  Object.defineProperty(iframe, 'offsetWidth', { value: 1000 });
  Object.defineProperty(iframe, 'offsetHeight', { value: 500 });
  Object.defineProperty(iframe, 'getBoundingClientRect', { value: () => ({ left: 100, top: 50, width: 500, height: 250, right: 600, bottom: 300 }) });
  Object.defineProperty(parent.document, 'elementFromPoint', { value: () => iframe, configurable: true });
  Object.defineProperty(child.document, 'elementFromPoint', { value: (x: number, y: number) => x === 200 && y === 100 ? button : child.document.body, configurable: true });
  Object.defineProperty(child, 'getComputedStyle', { value: () => ({ cursor: 'pointer' }), configurable: true });
  const interaction = createDemoCursorInteraction({ root, iframe });
  expect(interaction.update({ x: 200, y: 100 })).toBe('pointer');
  expect(button.getAttribute('data-demo-hover')).toBe('true');
  interaction.destroy();
});
