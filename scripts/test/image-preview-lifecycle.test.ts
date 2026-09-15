import assert from 'node:assert/strict';
import { createImagePreviewUpgrade } from '../../src/lib/imagePreviewUpgrade';

// Exercise cancellation and instance ownership without simulating browser interaction.
const frames = new Map<number, FrameRequestCallback>();
const timers = new Map<number, () => void>();
const timerDelays = new Map<number, number>();
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
  private _src = '/thumb.webp';
  get src() { return this._src; }
  set src(value: string) { this._src = value; this.currentSrc = new URL(value, 'https://demo.test/').href; }
  currentSrc = 'https://demo.test/thumb.webp';
  complete = true;
  naturalWidth = 1200;
  naturalHeight = 800;
  isConnected = true;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode: () => Promise<void> = () => Promise.resolve();
  clone?: TestImage;
  top = 20;
  constructor() { super(); images.push(this); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  getBoundingClientRect() { return { top: this.top, left: 20, bottom: this.top + 200, right: 320 }; }
  cloneNode() { const clone = new TestImage(); clone.attributes = new Map(this.attributes); return clone; }
  insertAdjacentElement(_where: string, clone: TestImage) { this.clone = clone; }
  remove() { this.isConnected = false; }
}

class TestObserver {
  disconnected = false;
  observed = new Set<TestImage>();
  constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean; target: TestImage }>) => void) { observers.push(this); }
  observe(image: TestImage) { this.observed.add(image); }
  unobserve(image: TestImage) { this.observed.delete(image); }
  emit(...entries: Array<{ isIntersecting: boolean; target: TestImage }>) { this.callback(entries); }
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
    setTimeout(callback: () => void, ms: number) {
      const id = ++nextId;
      timerDelays.set(id, ms);
      timers.set(id, () => { timers.delete(id); timerDelays.delete(id); callback(); });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); timerDelays.delete(id); },
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
const runTimer = (ms: number) => {
  const entry = [...timers.entries()].find(([id]) => timerDelays.get(id) === ms);
  assert.ok(entry, `expected a pending ${ms}ms timer`);
  entry[1]();
};
const previewImages = (src: string) => images.filter((image) => image.src === src);

try {
  const a = fixture('/a.webp');
  const b = fixture('/b.webp');
  b.image.setAttribute('data-image-original', '/original.webp');
  b.image.setAttribute('tabindex', '0');
  b.image.setAttribute('role', 'button');
  b.image.setAttribute('aria-label', 'Open image');
  const first = createImagePreviewUpgrade();
  const second = createImagePreviewUpgrade();
  first.bind(a.root);
  const aThumb = images.at(-1)!;
  second.bind(b.root);
  const bThumb = images.at(-1)!;
  assert.equal(images.some((image) => image.src === '/a.webp'), false, 'binding is inert before opening');
  aThumb.onload!();
  await flush();
  assert.equal(images.some((image) => image.src === '/a.webp'), true, 'visible previews fetch before opening');
  first.open();
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

  bThumb.onload!();
  await flush();
  second.open();
  images.find((image) => image.src === '/b.webp')!.onload!();
  await flush();
  assert.ok(b.image.clone, 'the real reveal path creates a clone');
  for (const attr of ['data-image-original', 'tabindex', 'role', 'aria-label']) {
    assert.equal(b.image.clone!.hasAttribute(attr), false, 'decorative preview must not inherit lightbox interaction');
    assert.equal(b.image.hasAttribute(attr), true, 'the real image stays interactive');
  }
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
  images.at(-1)!.onload!();
  await flush();
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

  const ordered = [fixture('/top.webp'), fixture('/middle.webp'), fixture('/offscreen.webp')];
  ordered[0].image.top = 10;
  ordered[1].image.top = 300;
  ordered[2].image.top = 900;
  const priority = createImagePreviewUpgrade();
  priority.bind({ querySelectorAll: () => ordered.map(({ image }) => image) } as unknown as ParentNode);
  const thumbs = images.slice(-3);
  thumbs[2].onload!();
  thumbs[0].onload!();
  thumbs[1].onload!();
  await flush();
  const fetched = images.filter((image) => ['/top.webp', '/middle.webp', '/offscreen.webp'].includes(image.src));
  assert.deepEqual(fetched.map((image) => image.src), ['/top.webp', '/middle.webp'], 'visible previews fetch top-to-bottom and off-screen work waits');

  ordered[2].image.top = 400;
  observers.at(-1)!.emit({ isIntersecting: true, target: ordered[2].image });
  await flush();
  assert.equal(images.filter((image) => image.src === '/offscreen.webp').length, 1, 'off-screen preview fetches when it enters the viewport');
  priority.destroy();
  const replacement = fixture('/old-preview.webp');
  const replacing = createImagePreviewUpgrade();
  replacing.bind(replacement.root);
  images.at(-1)!.onload!();
  await flush();
  replacing.open();
  const oldPreview = images.find((image) => image.src === '/old-preview.webp')!;
  replacing.cancel(replacement.image as unknown as HTMLImageElement);
  replacement.image.src = '/replacement.webp';
  oldPreview.onload!();
  await flush();
  assert.equal(replacement.image.src, '/replacement.webp', 'late preview load cannot undo replacement');
  assert.equal(replacement.image.clone, undefined);
  replacing.destroy();

  const revealing = fixture('/revealing.webp');
  const revealReplacement = createImagePreviewUpgrade();
  revealReplacement.bind(revealing.root);
  images.at(-1)!.onload!();
  await flush();
  revealReplacement.open();
  images.find((image) => image.src === '/revealing.webp')!.onload!();
  await flush();
  const staleClone = revealing.image.clone!;
  assert.ok(staleClone.isConnected);
  revealReplacement.cancel(revealing.image as unknown as HTMLImageElement);
  revealing.image.src = '/new.webp';
  assert.equal(staleClone.isConnected, false, 'replacement removes the old reveal overlay immediately');
  for (const callback of [...timers.values()]) callback();
  await flush();
  assert.equal(revealing.image.src, '/new.webp', 'old reveal completion cannot overwrite replacement');
  revealReplacement.destroy();

  let recoveryFailures = 0;
  const thumbError = fixture('/thumb-error.webp');
  const thumbRecovery = createImagePreviewUpgrade({ onError: () => recoveryFailures++ });
  thumbRecovery.bind(thumbError.root);
  images.at(-1)!.onerror!();
  await flush();
  thumbRecovery.open();
  assert.equal(previewImages('/thumb-error.webp').length, 1, 'thumbnail errors release preview loading');
  thumbRecovery.destroy();

  const stalledThumb = fixture('/stalled-thumb.webp');
  const stalledRecovery = createImagePreviewUpgrade();
  stalledRecovery.bind(stalledThumb.root);
  const stalledThumbPreload = images.at(-1)!;
  stalledThumbPreload.decode = () => new Promise(() => {});
  stalledThumbPreload.onload!();
  for (const callback of [...timers.values()]) callback();
  await flush();
  stalledRecovery.open();
  assert.equal(previewImages('/stalled-thumb.webp').length, 1, 'stalled thumbnail decode falls back after its watchdog');
  stalledRecovery.destroy();

  const retry = fixture('/retry.webp');
  const retryRecovery = createImagePreviewUpgrade({ onError: () => recoveryFailures++ });
  retryRecovery.bind(retry.root);
  images.at(-1)!.onload!();
  await flush();
  const firstAttempt = previewImages('/retry.webp').at(-1)!;
  firstAttempt.onerror!();
  assert.equal(recoveryFailures, 1, 'preview failure callback runs immediately');
  observers.at(-1)!.emit({ isIntersecting: true, target: retry.image });
  await flush();
  assert.equal(previewImages('/retry.webp').length, 1, 'observer cannot bypass backoff');
  retry.image.top = 900;
  runTimer(1000);
  await flush();
  assert.equal(previewImages('/retry.webp').length, 1, 'retry waits while offscreen');
  retry.image.top = 20;
  observers.at(-1)!.emit({ isIntersecting: true, target: retry.image });
  await flush();
  const secondAttempt = previewImages('/retry.webp').at(-1)!;
  assert.notEqual(secondAttempt, firstAttempt, 'preview retry starts after backoff');
  secondAttempt.onload!();
  await flush();
  assert.equal(retry.image.dataset.imagePreviewUpgrading, undefined, 'successful retry clears upgrading state');
  assert.equal(timers.size, 0, 'successful fetch clears watchdog before the reveal gate opens');
  retryRecovery.open();
  assert.ok(retry.image.clone, 'successful retry reaches the reveal');
  retryRecovery.destroy();

  const exhausted = fixture('/exhausted.webp');
  const exhaustedRecovery = createImagePreviewUpgrade({ onError: () => recoveryFailures++ });
  exhaustedRecovery.bind(exhausted.root);
  images.at(-1)!.onload!();
  await flush();
  exhaustedRecovery.open();
  for (let attempt = 0; attempt < 3; attempt++) {
    previewImages('/exhausted.webp').at(-1)!.onerror!();
    if (attempt < 2) {
      runTimer(attempt === 0 ? 1000 : 2000);
      await flush();
    }
  }
  const requestCount = previewImages('/exhausted.webp').length;
  observers.at(-1)!.emit({ isIntersecting: true, target: exhausted.image });
  observers.at(-1)!.emit({ isIntersecting: true, target: exhausted.image });
  await flush();
  assert.equal(previewImages('/exhausted.webp').length, requestCount, 'observer events cannot exceed retry cap');
  assert.equal(requestCount, 3, 'preview retries stop at three total attempts');
  assert.equal(exhausted.image.src, '/thumb.webp', 'exhaustion retains the thumbnail');
  exhaustedRecovery.destroy();

  const late = fixture('/late-timeout.webp');
  const lateRecovery = createImagePreviewUpgrade({ onError: () => recoveryFailures++ });
  lateRecovery.bind(late.root);
  images.at(-1)!.onload!();
  await flush();
  lateRecovery.open();
  const lateRequest = previewImages('/late-timeout.webp').at(-1)!;
  let completeLateDecode!: () => void;
  lateRequest.decode = () => new Promise((resolve) => { completeLateDecode = resolve; });
  lateRequest.onload!();
  runTimer(15000);
  completeLateDecode();
  await flush();
  assert.equal(late.image.src, '/thumb.webp', 'timed-out late completion cannot upgrade the image');
  assert.equal(late.image.clone, undefined, 'timed-out decode cannot begin a stale reveal');
  lateRecovery.destroy();

  const canceledRetry = fixture('/canceled-retry.webp');
  const canceledRecovery = createImagePreviewUpgrade();
  canceledRecovery.bind(canceledRetry.root);
  images.at(-1)!.onload!();
  await flush();
  canceledRecovery.open();
  previewImages('/canceled-retry.webp').at(-1)!.onerror!();
  const timersBeforeCancel = timers.size;
  assert.ok(timersBeforeCancel > 0, 'failed attempt schedules retry backoff');
  canceledRecovery.cancel(canceledRetry.image as unknown as HTMLImageElement);
  assert.equal(timers.size, timersBeforeCancel - 1, 'cancel clears pending retry work');
  canceledRecovery.destroy();

  const callbackDestroy = fixture('/callback-destroy.webp');
  let destroyingRecovery: ReturnType<typeof createImagePreviewUpgrade>;
  destroyingRecovery = createImagePreviewUpgrade({ onError: () => destroyingRecovery.destroy() });
  destroyingRecovery.bind(callbackDestroy.root);
  images.at(-1)!.onload!();
  await flush();
  destroyingRecovery.open();
  previewImages('/callback-destroy.webp').at(-1)!.onerror!();
  assert.equal(callbackDestroy.image.dataset.imagePreviewUpgrading, undefined, 'callback destruction clears the failed attempt');
  assert.equal(timers.size, 0, 'onError destruction cannot schedule a retry');
  destroyingRecovery.destroy();

  await flush();
  assert.equal(timers.size, 0);
  console.log('image-preview-lifecycle: passed (isolation, recovery, bounded retries, stale decode, cancellation, disposal)');
} finally {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
