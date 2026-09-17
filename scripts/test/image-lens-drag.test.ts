import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imageLensBounds } from '../../src/lib/imageLensBounds';

// Exercise the real controller without a browser, rendering, or synthetic UI interaction.
class Element extends EventTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  nodes: Record<string, Element> = {};
  captures = new Set<number>();
  clientWidth = 800;
  width = 300;
  height = 150;
  complete = false;
  naturalWidth = 4032;
  rect = { left: 0, top: 0, right: 800, bottom: 576, width: 800, height: 576 };
  querySelector(selector: string) { return this.nodes[selector]; }
  getBoundingClientRect() { return this.rect; }
  getContext() { return {}; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  decode() { return new Promise(() => {}); }
}
const host = new Element();
for (const key of ['.glass-root', '.glass-source', '[data-image-root]', '.lens', '[data-load]', '[data-reset]', '.status', '.actions', 'template']) host.nodes[key] = new Element();
host.nodes['.glass-root'].rect = { left: 176, top: 120, right: 624, bottom: 456, width: 448, height: 336 };
host.nodes['.actions'].rect = { left: 350, top: 494, right: 450, bottom: 538, width: 100, height: 44 };
host.nodes['[data-image-root]'].nodes['[data-progressive-image]'] = new Element();
const lens = host.nodes['.lens'];
const resizeCallbacks: Array<() => void> = [];
class ResizeObserver {
  constructor(callback: () => void) { resizeCallbacks.push(callback); }
  observe() {}
  disconnect() {}
}
class MutationObserver { observe() {} disconnect() {} }
const html = new Element();
const document = Object.assign(new EventTarget(), { documentElement: html, fonts: { ready: Promise.resolve() }, createElement: () => new Element() });
const window = new EventTarget();
const media = Object.assign(new EventTarget(), { matches: false });
const getComputedStyle = () => ({ borderTopLeftRadius: '11.2px', borderTopRightRadius: '11.2px', borderBottomRightRadius: '11.2px', borderBottomLeftRadius: '11.2px', backgroundColor: 'rgb(249, 249, 251)', getPropertyValue: () => '#f9f9fb' });
const source = readFileSync(new URL('../../src/components/project/demos/ProgressiveImageDemo.astro', import.meta.url), 'utf8').match(/<script>([^]*?)<\/script>/)![1].replace(/^\s*import .*;\s*$/gm, '');
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
let time = 0;
let nextFrame = 0;
const frames = new Map<number, (time: number) => void>();
const advance = (ms: number) => { time += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
const initialize = new Function('imageLensBounds', 'LiquidGlass', 'HTMLElement', 'customElements', 'document', 'window', 'matchMedia', 'getComputedStyle', 'ResizeObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio', 'performance', `${javascript}; return initializeDemo;`)(imageLensBounds, {}, Element, { get: () => true }, document, window, () => media, getComputedStyle, ResizeObserver, MutationObserver, (callback: (time: number) => void) => { frames.set(++nextFrame, callback); return nextFrame; }, (id: number) => frames.delete(id), 2, { now: () => time });
const dispose = initialize(host);
resizeCallbacks.forEach(callback => callback());
const pointer = (type: string, x: number, y: number) => lens.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y }));
pointer('pointerdown', 100, 100);
pointer('pointermove', 130, 120);
assert.equal(lens.style.transform, 'translate(30px, 20px)');
resizeCallbacks.forEach(callback => callback());
assert.ok(lens.hasPointerCapture(1), 'bounds refresh must not release an active drag');
pointer('pointermove', 150, 140);
assert.equal(lens.style.transform, 'translate(50px, 40px)', 'drag continues from its last pointer position');
pointer('pointerup', 150, 140);
assert.equal(lens.hasPointerCapture(1), false);
assert.equal(lens.style.transform, 'translate(50px, 40px)');
pointer('pointerdown', 150, 140);
pointer('pointermove', -10000, 140);
const stretched = lens.style.transform;
time += 100;
pointer('pointerup', -10000, 140);
assert.ok(frames.size, 'release beyond the boundary schedules a spring');
advance(16);
const returning = lens.style.transform;
assert.notEqual(returning, stretched, 'spring moves toward rest');
resizeCallbacks.forEach(callback => callback());
assert.equal(lens.style.transform, returning, 'observer refresh must not snap a running spring');
assert.ok(frames.size, 'observer refresh must preserve the spring callback');
advance(16);
assert.notEqual(lens.style.transform, returning, 'spring continues after refresh');
for (let i = 0; i < 45; i++) advance(16);
assert.equal(frames.size, 0, 'spring settles');
dispose();
pointer('pointerdown', 200, 200);
assert.equal(lens.hasPointerCapture(1), false, 'disposal removes drag handlers');
console.log('image-lens-drag: passed (movement, resize during capture, release, disposal)');
