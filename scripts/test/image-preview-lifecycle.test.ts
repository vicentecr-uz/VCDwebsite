import assert from 'node:assert/strict';
import { createImagePreviewUpgrade } from '../../src/lib/imagePreviewUpgrade';

// Exercise cancellation and instance ownership without simulating browser interaction.
const frames = new Map<number, FrameRequestCallback>();
const timers = new Map<number, () => void>();
const images: TestImage[] = [];
const observers: TestObserver[] = [];
let nextId = 0;

class TestImage extends EventTarget {
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  classes = new Set<string>();
  classList = {
    contains: (name: string) => this.classes.has(name),
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
  };
  style: Record<string, string> = {};
  className = '';
  alt = '';
  src = '/thumb.webp';
  currentSrc = '';
  complete = true;
  naturalWidth = 1200;
  naturalHeight = 800;
  isConnected = true;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode: () => Promise<void> = () => Promise.resolve();
  clone?: TestImage;
  constructor() { super(); images.push(this); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  getBoundingClientRect() { return { top: 20, left: 20, bottom: 220, right: 320 }; }
  cloneNode() { return new TestImage(); }
  insertAdjacentElement(_where: string, clone: TestImage) { this.clone = clone; }
  remove() { this.isConnected = false; }
}

class TestObserver {
  disconnected = false;
  observed = new Set<TestImage>();
  constructor() { observers.push(this); }
  observe(image: TestImage) { this.observed.add(image); }
  unobserve(image: TestImage) { this.observed.delete(image); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
}

const overrides = {
  Image: TestImage,
  IntersectionObserver: TestObserver,
  location: { href: 'https://demo.test/' },
  getComputedStyle: () => ({ position: 'absolute' }),
  window: {
    innerWidth: 800,
    innerHeight: 600,
    setTimeout(callback: () => void) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  },
  requestAnimationFrame(callback: FrameRequestCallback) { const id = ++nextId; frames.set(id, callback); return id; },
  cancelAnimationFrame(id: number) { frames.delete(id); },
};
const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, value });

const fixture = (preview: string) => {
  const image = new TestImage();
  image.setAttribute('data-image-preview', preview);
  return { image, root: { querySelectorAll: () => [image] } as unknown as ParentNode };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

try {
  const a = fixture('/a.webp');
  const b = fixture('/b.webp');
  const first = createImagePreviewUpgrade();
  const second = createImagePreviewUpgrade();
  first.bind(a.root);
  second.bind(b.root);
  assert.equal(images.some((image) => image.src === '/a.webp'), false, 'binding is inert before opening');
  first.open();
  assert.equal(images.some((image) => image.src === '/a.webp'), true);
  assert.equal(images.some((image) => image.src === '/b.webp'), false, 'opening one instance must not open another');

  const loading = images.find((image) => image.src === '/a.webp')!;
  let finishDecode!: () => void;
  loading.decode = () => new Promise((resolve) => { finishDecode = resolve; });
  loading.onload!();
  first.destroy();
  finishDecode();
  await flush();
  assert.equal(a.image.src, '/thumb.webp', 'late decoding must not replace reset content');
  assert.equal(a.image.clone, undefined);
  assert.equal(a.image.dataset.imagePreviewBound, undefined);
  assert.equal(observers[0].disconnected, true);
  assert.equal(observers[1].disconnected, false, 'destroy remains instance-local');

  second.open();
  images.find((image) => image.src === '/b.webp')!.onload!();
  await flush();
  assert.ok(b.image.clone, 'the real reveal path creates a clone');
  assert.ok(frames.size > 0);
  assert.ok(timers.size > 0);
  second.destroy();
  assert.equal(b.image.clone!.isConnected, false);
  assert.equal(frames.size, 0, 'destroy cancels reveal frames');
  assert.equal(timers.size, 0, 'destroy cancels reveal fallback timers');
  assert.equal(b.image.src, '/thumb.webp');

  let failures = 0;
  const c = fixture('/missing.webp');
  const failing = createImagePreviewUpgrade({ onError: () => failures++ });
  failing.bind(c.root);
  failing.open();
  images.find((image) => image.src === '/missing.webp')!.onerror!();
  assert.equal(failures, 1);
  assert.equal(c.image.dataset.imagePreviewUpgrading, undefined);
  failing.destroy();
  const before = images.length;
  failing.bind(c.root);
  failing.open();
  assert.equal(images.length, before, 'disposed instances cannot restart');
  assert.ok(observers.every((observer) => observer.disconnected));
  console.log('image-preview-lifecycle: passed (instance isolation, reset during decode/reveal, failure, disposal)');
} finally {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
