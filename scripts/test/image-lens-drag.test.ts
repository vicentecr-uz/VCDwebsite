import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imageLensBounds } from '../../src/lib/imageLensBounds';
import * as inertia from '../../src/lib/imageLensInertia';

// Exercise the real controller without a browser, rendering, or synthetic UI interaction.
class CanvasContext {
  transform = [1, 0, 0, 1, 0, 0];
  draws: Array<{ image: Element; transform: number[]; args: number[] }> = [];
  stack: number[][] = [];
  resetTransform() { this.transform = [1, 0, 0, 1, 0, 0]; }
  setTransform(...values: number[]) { this.transform = values; }
  save() { this.stack.push([...this.transform]); }
  restore() { this.transform = this.stack.pop()!; }
  clearRect() {} fillRect() {} fill() {} fillText() {} beginPath() {} roundRect() {} clip() {}
  createLinearGradient() { return { addColorStop() {} }; }
  drawImage(image: Element, ...args: number[]) { this.draws.push({ image, args, transform: [...this.transform] }); }
}
class Element extends EventTarget {
  style = { setProperty(name: string, value: string) { Object.assign(this, { [name]: value }); } } as { [name: string]: string; setProperty(name: string, value: string): void };
  dataset: Record<string, string> = {};
  nodes: Record<string, Element> = {};
  captures = new Set<number>();
  clientWidth = 800;
  width = 300;
  height = 150;
  complete = false;
  naturalWidth = 4032;
  removed = false;
  rect = { left: 0, top: 0, right: 800, bottom: 576, width: 800, height: 576 };
  querySelector(selector: string) { return this.nodes[selector]; }
  querySelectorAll(_selector: string) { return []; }
  append(..._nodes: Element[]) {}
  setAttribute(_name: string, _value: string) {}
  removeAttribute(_name: string) {}
  getAttribute(_name: string) { return null; }
  click() { this.dispatchEvent(new Event('click')); }
  remove() { this.removed = true; }
  toggleAttribute(_name: string, _value: boolean) {}
  getBoundingClientRect() { return this.rect; }
  context = new CanvasContext();
  getContext() { return this.context; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  decode() { return new Promise(() => {}); }
}
const host = new Element();
for (const key of ['.glass-root', '.glass-source', '[data-image-root]', '.lens', '[data-load]', '[data-reset]', '.status', '.actions', 'template']) host.nodes[key] = new Element();
const lensTooltip = new Element();
lensTooltip.nodes['svg'] = new Element();
lensTooltip.nodes['[data-tooltip-shape]'] = new Element();
host.nodes['#progressive-image-lens-tooltip'] = lensTooltip;
host.nodes['[data-hint]'] = new Element();
host.nodes['[data-hint-pointer]'] = new Element();
host.nodes['.glass-root'].rect = { left: 176, top: 120, right: 624, bottom: 456, width: 448, height: 336 };
host.nodes['.actions'].rect = { left: 350, top: 494, right: 450, bottom: 538, width: 100, height: 44 };
host.nodes['[data-image-root]'].nodes['[data-progressive-image]'] = new Element();
host.nodes['[data-image-root]'].nodes['img[data-progressive-image]'] = host.nodes['[data-image-root]'].nodes['[data-progressive-image]'];
const baseImage = host.nodes['[data-image-root]'].nodes['[data-progressive-image]'];
baseImage.insertAdjacentElement = (_position: string, image: Element) => { host.nodes['[data-image-root]'].nodes['active-image'] = image; return image; };
host.nodes.template.content = { cloneNode() {
  const image = new Element();
  image.complete = false;
  image.naturalWidth = 0;
  image.nodes['[data-progressive-image]'] = image;
  return { querySelector: () => image };
} };
host.nodes['[data-image-root]'].nodes['.image-quality-badge--low'] = new Element();
host.nodes['[data-image-root]'].nodes['.image-quality-badge--high'] = new Element();
const lens = host.nodes['.lens'];
const resizeCallbacks: Array<() => void> = [];
class ResizeObserver {
  constructor(callback: () => void) { resizeCallbacks.push(callback); }
  observe() {}
  disconnect() {}
}
class MutationObserver { observe() {} disconnect() {} }
const html = new Element();
const canvases: Element[] = [];
const document = Object.assign(new EventTarget(), { documentElement: html, body: new Element(), fonts: { ready: Promise.resolve() }, createElement: (tag: string) => { const canvas = new Element(); if (tag === 'canvas') canvases.push(canvas); return canvas; } });
const window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
const media = Object.assign(new EventTarget(), { matches: false });
const getComputedStyle = () => ({ borderTopLeftRadius: '11.2px', borderTopRightRadius: '11.2px', borderBottomRightRadius: '11.2px', borderBottomLeftRadius: '11.2px', backgroundColor: 'rgb(249, 249, 251)', opacity: '1', getPropertyValue: (name: string) => name === '--preview-reveal-y' ? '122%' : '#f9f9fb' });
const source = readFileSync(new URL('../../src/components/project/demos/ProgressiveImageDemo.astro', import.meta.url), 'utf8').match(/<script>([^]*?)<\/script>/)![1]
  .replace(/^\s*import .*;\s*$/gm, '')
  .replace(/import\.meta\.env\.DEV/g, 'false');
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`const { createEaseOut, inWall, LENS_INERTIA, stepContact } = inertia;\n${source}`);
let time = 0;
let nextFrame = 0;
const frames = new Map<number, (time: number) => void>();
const advance = (ms: number) => { time += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
const upgradeAttempts: Array<{ image: Element; destroy(): void; bind(): void; open(): void }> = [];
const createImagePreviewUpgrade = () => { const image = host.nodes['[data-image-root]'].nodes['active-image']; const attempt = { image, destroy() {}, bind() {}, open() {} }; upgradeAttempts.push(attempt); return attempt; };
const initialize = new Function('imageLensBounds', 'inertia', 'LiquidGlass', 'HTMLElement', 'customElements', 'document', 'window', 'matchMedia', 'getComputedStyle', 'ResizeObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio', 'performance', 'createImagePreviewUpgrade', `${javascript}; return initializeDemo;`)(imageLensBounds, inertia, {}, Element, { get: () => true }, document, window, () => media, getComputedStyle, ResizeObserver, MutationObserver, (callback: (time: number) => void) => { frames.set(++nextFrame, callback); return nextFrame; }, (id: number) => frames.delete(id), 2, { now: () => time }, createImagePreviewUpgrade);
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
const reveal = new Element();
baseImage.complete = reveal.complete = true;
host.nodes['[data-image-root]'].nodes['[data-preview-reveal]'] = reveal;
resizeCallbacks.forEach(callback => callback());
const sourceCanvas = host.nodes['.glass-source'];
const mask = canvases[0];
const photoDraw = () => sourceCanvas.context.draws.filter((draw) => draw.image === baseImage || draw.image === host.nodes['[data-image-root]'].nodes['active-image']).at(-1)!.image;
const load = host.nodes['[data-load]'];
load.click();
const activeImage = host.nodes['[data-image-root]'].nodes['active-image'];
resizeCallbacks.forEach(callback => callback());
assert.equal(photoDraw(), baseImage, 'decoding upgrade keeps the persistent thumbnail in the lens');
activeImage.complete = true;
activeImage.naturalWidth = 4032;
activeImage.dataset.imageUpgraded = 'true';
resizeCallbacks.forEach(callback => callback());
assert.equal(photoDraw(), activeImage, 'ready upgrade is sampled by the lens');
load.click();
assert.equal(photoDraw(), baseImage, 'unload samples the thumbnail synchronously');
const revealDraw = mask.context.draws.at(-1)!;
const latestBaseDraw = sourceCanvas.context.draws.filter((draw) => draw.image === baseImage).at(-1)!;
assert.deepEqual(revealDraw.image, reveal, 'mask samples the reveal image');
assert.deepEqual(latestBaseDraw.transform, revealDraw.transform, 'thumb and reveal use identical magnified sampling');
assert.equal(mask.width, sourceCanvas.width, 'reveal crop retains the full source pixel density');
assert.equal(mask.height, sourceCanvas.height);
assert.deepEqual(sourceCanvas.context.draws.at(-1)!.args, [0, 0], 'composite the reveal without another rescale');
delete host.nodes['[data-image-root]'].nodes['[data-preview-reveal]'];
resizeCallbacks.forEach(callback => callback());
const finalImageDraw = sourceCanvas.context.draws.filter((draw) => draw.image === baseImage).at(-1)!;
assert.deepEqual(finalImageDraw.transform, revealDraw.transform, 'final image retains the reveal sampling density');
dispose();
pointer('pointerdown', 200, 200);
assert.equal(lens.hasPointerCapture(1), false, 'disposal removes drag handlers');

{
  const stepper = inertia.createEaseOut({ x: 900, y: 0 }, 10);
  let velocity = { x: 900, y: 0 };
  for (let i = 0; i < 80; i++) velocity = stepper.step(0.016, 10).velocity;
  assert.equal(velocity.x, 0, 'ease-out reaches 0 without a threshold cutoff');
}
{
  const bounds = { min: 0, x: 200, y: 200 };
  let pos = { x: 202, y: 80 };
  let vel = { x: 900, y: 0 };
  let minX = pos.x;
  for (let i = 0; i < 50; i++) {
    const next = inertia.stepContact(pos, vel, 0.016, bounds, 24);
    pos = next.position;
    vel = next.velocity;
    minX = Math.min(minX, pos.x);
  }
  assert.ok(minX < 200, 'bumper returns inside the boundary after a hard hit');
}

console.log('image-lens-drag: passed (movement, resize during capture, release, disposal)');
