import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'bun:test';
import gsap from 'gsap';

const layout = readFileSync(process.env.LAYOUT_TEST_SOURCE ?? new URL('../../src/layouts/Layout.astro', import.meta.url), 'utf8');
const spinnerMarkup = readFileSync(new URL('../../src/components/ui/LoadingSpinner.svg', import.meta.url), 'utf8');
test('scrub transition UI and source instrumentation are removed', () => {
  assert.doesNotMatch(layout, /DevTransitionTimeline|dev-transition[^\n]*scrub|data-transition-(?:image-index|thumb-src|preview-src)|Scrub transition/);
  assert.match(layout, /transitionMode === 'visible'/);
  assert.doesNotMatch(layout, /transitionMode === 'scrub'/);
});
test('layout readiness has an independent early initializer', () => {
  const headInitializer = layout.match(/<head>\s*<!--[\s\S]*?-->\s*<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.match(headInitializer, /import \{ bindSafeVh \} from ['"]\.\.\/lib\/safeVh['"]/);
  assert.match(headInitializer, /bindSafeVh\(\);/);
  assert.match(headInitializer, /pathname\.endsWith\('\.css'\)/);
  assert.match(headInitializer, /searchParams\.get\('type'\) === 'style'/);
  assert.match(headInitializer, /addEventListener\('error'/);
  assert.doesNotMatch(headInitializer, /gsap|persistentNavigation|imagePreviewUpgrade|pageLifecycle/);
  assert.doesNotMatch(script ?? '', /bindSafeVh/);
  assert.match(layout, /<link rel="stylesheet" href="\/fonts\/hanken-grotesk\/hanken\.css"/);
  assert.match(layout, /<link rel="preload" href="\/fonts\/hanken-grotesk\/normal-latin\.woff2"/);
  assert.doesNotMatch(layout, /fonts\.googleapis\.com|fonts\.gstatic\.com|media="print"/);
});

test('production visible diagnostic is limited to loopback hosts and the veil', () => {
  const productionParser = layout.match(/\{!showDevTools && \(\s*<script is:inline>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const productionStyle = layout.match(/\{!showDevTools && \(\s*<style is:inline>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.match(productionParser, /localhost/);
  assert.match(productionParser, /127\.0\.0\.1/);
  assert.match(productionParser, /['"]::1['"]/);
  assert.match(productionParser, /location\.hostname/);
  assert.match(productionParser, /transitionMode === 'visible'/);
  assert.doesNotMatch(productionParser, /transition-readiness-marker|DevModeController/);
  assert.match(productionStyle, /#transition-overlay/);
  assert.doesNotMatch(productionStyle, /transition-readiness-marker|background: #ff1493/);
});

test('cold loads cover with an inline veil before bundled CSS', () => {
  const critical = layout.match(/<style is:inline>\s*\/\* Cover the first paint[\s\S]*?<\/style>/)?.[0] ?? '';
  assert.match(critical, /#transition-overlay\s*\{[^}]*position:\s*fixed/);
  assert.match(critical, /#transition-overlay\s*\{[^}]*opacity:\s*1/);
  assert.match(layout, /<a href="#main-content"[\s\S]*?<div id="transition-overlay" data-loading="true">/);
});
test('cold loads include an accessible delayed activity indicator in the veil', () => {
  assert.match(layout, /<div id="transition-overlay" data-loading="true">\s*<div role="status" aria-label="Loading page">\s*<Fragment set:html=\{spinnerMarkup\} \/>/);
  assert.match(spinnerMarkup, /^<svg[^>]*class="loading-spinner"[^>]*aria-hidden="true"/);
});
const script = [...layout.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).find((source) => source.includes("import gsap from 'gsap'"));
assert.ok(script, 'Exercise the actual Layout transition script');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.replace(/^\s*import .*?;\s*$/gm, ''));
const earlyScript = layout.match(/<script is:inline>\s*((?:\(\(\) => \{)[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1];
assert.ok(earlyScript, 'Exercise the actual initial reveal controller');
const earlyCompiled = new Bun.Transpiler({ loader: 'js' }).transformSync(earlyScript);

class Target {
  listeners = new Map<string, Map<Function, { once?: boolean; signal?: AbortSignal; abort?: () => void }>>();
  addEventListener(type: string, listener: Function, options: any = {}) {
    if (options.signal?.aborted) return;
    const listeners = this.listeners.get(type) ?? new Map();
    if (listeners.has(listener)) return;
    const abort = options.signal ? () => this.removeEventListener(type, listener) : undefined;
    listeners.set(listener, { once: options.once, signal: options.signal, abort });
    this.listeners.set(type, listeners);
    if (abort) options.signal.addEventListener('abort', abort, { once: true });
  }
  removeEventListener(type: string, listener: Function) {
    const record = this.listeners.get(type)?.get(listener);
    if (record?.abort) record.signal?.removeEventListener('abort', record.abort);
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: any = {}) {
    for (const [listener, options] of [...(this.listeners.get(type) ?? [])]) {
      if (!this.listeners.get(type)?.has(listener)) continue;
      if (options.once) this.removeEventListener(type, listener);
      listener(event);
    }
    return event;
  }
  dispatchEvent(event: any) { return this.emit(event.type, event); }
  count(type: string) { return this.listeners.get(type)?.size ?? 0; }
}

const sourceUrl = 'https://vcd.test/work/';
class Anchor extends Target {
  dataset: Record<string, string> = {};
  attributes: Record<string, string>;
  constructor(href: string, attributes: Record<string, string> = {}) {
    super();
    this.attributes = { href, ...attributes };
  }
  get href() { return new URL(this.attributes.href ?? '', sourceUrl).href; }
  get target() { return this.attributes.target ?? ''; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  hasAttribute(name: string) { return name in this.attributes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
}

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class ImageFixture extends Target {
  complete = false;
  naturalWidth = 0;
  loading = '';
  decodeCalls = 0;
  decoded = deferred();
  parentElement: ContainerFixture | null = null;
  frame: ContainerFixture | null = null;
  preview = true;
  style: Record<string, string> = { overflow: 'clip' };
  rect: { top: number; left: number; bottom: number; right: number };
  constructor(public visible = true) {
    super();
    this.rect = visible
      ? { top: 0, left: 0, bottom: 100, right: 100 }
      : { top: 900, left: 0, bottom: 1000, right: 100 };
  }
  getBoundingClientRect() {
    return this.rect;
  }
  closest() { return this.frame; }
  decode() { this.decodeCalls++; return this.decoded.promise; }
  load() { this.complete = true; this.naturalWidth = 300; this.emit('load'); }
  fail() { this.complete = true; this.naturalWidth = 0; this.emit('error'); }
}

class ContainerFixture {
  parentElement: ContainerFixture | null = null;
  style: Record<string, string>;
  constructor(
    public rect = { top: 0, left: 0, bottom: 100, right: 100 },
    style: Record<string, string> = {},
  ) { this.style = style; }
  getBoundingClientRect() { return this.rect; }
  contains(element: ImageFixture) {
    for (let current: ContainerFixture | null = element.parentElement; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
}

class ReadinessRoot extends Target {
  dataset: Record<string, string> = {};
  parentElement: ContainerFixture | null = null;
  style: Record<string, string> = {};
  constructor(public visible = true) {
    super();
  }
  getBoundingClientRect() {
    return this.visible
      ? { top: 0, left: 0, bottom: 100, right: 100 }
      : { top: 900, left: 0, bottom: 1000, right: 100 };
  }
  closest() { return null; }
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function fixture(options: { images?: ImageFixture[]; readinessRoots?: ReadinessRoot[]; fonts?: Promise<void>; fontSetReady?: Promise<void>; fontFaces?: Array<{ status: string; loaded: Promise<void> }>; noOverlay?: boolean; noReadinessMarker?: boolean; initialController?: boolean; intro?: boolean; layoutPending?: boolean; deferNavigationModule?: boolean; homeIntro?: { state?: 'active' | 'dismissed'; images?: ImageFixture[] }; reduced?: boolean; visible?: boolean; failTween?: boolean; failUpgrade?: boolean; failNavigation?: boolean; deferAnimationReady?: boolean; failAnimation?: boolean } = {}) {
  let now = 0;
  let nextId = 0;
  let bodyReads = 0;
  const timers = new Map<number, { at: number; callback: Function }>();
  const frames = new Map<number, Function>();
  const animations: any[] = [];
  const overlay = Object.assign(new Target(), {
    dataset: {},
    style: { opacity: '1', animation: '', transition: '', removeProperty(name: string) { delete (this as any)[name]; } },
    animate(keyframes: any, animationOptions: any) {
      if (options.failAnimation) throw new Error('animation unavailable');
      let ready = deferred();
      void ready.promise.catch(() => undefined);
      const settled = deferred();
      let heldTime = 0;
      let startTime: number | null = null;
      const animation = {
        keyframes, options: animationOptions, finished: settled.promise,
        get ready() { return ready.promise; },
        pending: false, playState: 'running', playCalls: 0,
        get startTime() { return startTime; },
        set startTime(value: number | null) {
          startTime = value;
          // WAAPI resolves pending readiness when an explicit start time takes over.
          if (this.pending) { this.pending = false; ready.resolve(); }
        },
        get currentTime() { return this.playState === 'running' && this.startTime !== null ? now - this.startTime : heldTime; },
        set currentTime(value: number) { heldTime = value; },
        pause() { heldTime = this.currentTime; this.playState = 'paused'; this.startTime = null; },
        play() {
          this.playCalls++;
          this.playState = 'running';
          startTime = null;
          this.pending = true;
          ready = deferred();
          void ready.promise.catch(() => undefined);
          if (!options.deferAnimationReady) void Promise.resolve().then(() => this.start());
        },
        cancel() { this.pending = false; this.playState = 'idle'; settled.reject(new Error('animation canceled')); ready.reject(new Error('animation canceled')); },
        start() {
          if (!this.pending) return;
          this.pending = false;
          startTime = now - 82;
          ready.resolve();
        },
        finish() { settled.resolve(); },
      };
      animations.push(animation);
      return animation;
    },
  });
  const readinessMarker = { hidden: true };
  const homeIntro = options.homeIntro ? Object.assign(new ContainerFixture(), { hidden: options.homeIntro.state === 'dismissed', dataset: { state: options.homeIntro.state ?? 'active' } }) : null;
  for (const image of options.homeIntro?.images ?? []) image.parentElement = homeIntro;
  const anchors = [new Anchor('/about/'), new Anchor('/play/')];
  const document = Object.assign(new Target(), {
    images: options.images ?? [],
    fonts: {
      ready: options.fontSetReady ?? options.fonts ?? Promise.resolve(),
      [Symbol.iterator]: () => (options.fontFaces ?? (options.fonts ? [{ status: 'loaded', loaded: options.fonts }] : []))[Symbol.iterator](),
    },
    body: { getBoundingClientRect() { bodyReads++; return { top: 0, left: 0, bottom: 800, right: 1200 }; } },
    documentElement: {
      clientHeight: 800, clientWidth: 1200,
      dataset: {
        ...(options.visible ? { devTransition: 'visible' } : {}),
        ...(options.layoutPending || options.intro ? {} : { introLayoutReady: 'true' }),
      },
      removeAttribute(name: string) { if (name === 'data-header-navigation') delete (this.dataset as any).headerNavigation; },
    },
    getElementById: (id: string) => id === 'transition-readiness-marker'
      ? (options.noReadinessMarker ? null : readinessMarker)
      : (options.noOverlay ? null : overlay),
    querySelector: (selector: string) => selector === '.project-block--intro' && options.intro ? {}
      : selector === '[data-home-intro-surface]' ? homeIntro : null,
    querySelectorAll: (selector: string) => selector === '[data-page-reveal-ready]'
      ? options.readinessRoots ?? []
      : selector === 'img'
      ? options.images ?? []
      : selector === 'img[data-image-preview]'
        ? (options.images ?? []).filter((image) => image.preview)
      : selector === 'a' ? anchors : [],
  });
  const destinations: string[] = [];
  const location = {
    origin: new URL(sourceUrl).origin,
    get href() { return sourceUrl; },
    set href(value: string) {
      if (options.failNavigation) throw new Error('navigation unavailable');
      destinations.push(value);
    },
  };
  const setTimeout = (callback: Function, delay = 0) => {
    const id = ++nextId;
    timers.set(id, { at: now + delay, callback });
    return id;
  };
  const clearTimeout = (id: number) => timers.delete(id);
  const requestAnimationFrame = (callback: Function) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  };
  const cancelAnimationFrame = (id: number) => frames.delete(id);
  const window = Object.assign(new Target(), {
    location, innerHeight: 800, innerWidth: 1200,
    setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
    matchMedia: () => ({ matches: options.reduced ?? false }),
  });
  const marks: Array<{ name: string; options?: any }> = [];
  const tweens: any[] = [];
  let persistentHooks: any;
  let upgrades = 0;
  let bound = 0;
  const fakeGsap = {
    to(target: any, vars: any) {
      if (options.failTween) throw new Error('tween unavailable');
      const element = typeof target === 'string' ? overlay : target;
      const tween = {
        vars, element, startOpacity: Number(element.style.opacity), killed: false, completed: false,
        kill() { this.killed = true; },
        finish() {
          if (this.killed || this.completed) return;
          this.completed = true;
          element.style.opacity = String(vars.opacity);
          vars.onComplete?.();
        },
      };
      tweens.push(tween);
      return tween;
    },
    killTweensOf(target: any) { tweens.filter((t) => t.element === target).forEach((t) => t.kill()); },
    fromTo(target: any, from: any, vars: any) { Object.assign(target.style, from); return this.to(target, vars); },
    set(target: any, values: any) { Object.assign(target.style, values); },
  };
  const context = {
    document, window, location, URL, AbortController, Promise,
    CustomEvent: class { constructor(public type: string, public init: any = {}) {} get detail() { return this.init.detail; } },
    performance: { now: () => now, mark: (name: string, markOptions?: any) => { marks.push({ name, options: markOptions }); } },
    Event: class { constructor(public type: string) {} }, innerHeight: 800, innerWidth: 1200,
    setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
    installPersistentNavigation(hooks: any) { persistentHooks = hooks; }, resetImagePreviewUpgrade() {},
    gsap: fakeGsap, bindSafeVh() {}, bindExternalLinks() {}, bindImagePreviewUpgrade() { bound++; },
    openImagePreviewUpgrade() { if (options.failUpgrade) throw new Error('upgrade unavailable'); upgrades++; },
    getComputedStyle: (element: any) => ({
      opacity: element.style?.opacity ?? overlay.style.opacity,
      display: element.style?.display ?? '', visibility: element.style?.visibility ?? '',
      overflow: element.style?.overflow ?? '', overflowX: element.style?.overflowX ?? '',
      overflowY: element.style?.overflowY ?? '',
    }),
    console: { warn() {}, error() {}, log() {} },
  };
  if ((options as any).initialController) runInNewContext(earlyCompiled, context);
  if (!options.deferNavigationModule) runInNewContext(compiled, context);
  return {
    overlay, readinessMarker, anchors, window, document, destinations, tweens, animations, frames, timers, marks, readinessRoots: options.readinessRoots ?? [],
    get persistentHooks() { return persistentHooks; },
    get upgrades() { return upgrades; }, get bound() { return bound; }, get bodyReads() { return bodyReads; },
    click(index = 0, properties: Record<string, unknown> = {}) {
      return anchors[index].emit('click', {
        button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
        preventDefault() { this.defaultPrevented = true; }, ...properties,
      });
    },
    async frame() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
      await flush();
    },
    async paint() { for (let i = 0; i < 5; i++) await this.frame(); },
    async finishReveal() { animations.at(-1)?.finish(); await flush(); },
    async advance(ms: number) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

test('initial reveal waits for styles and thumbnails without waiting for editing or navigation modules', async () => {
  const image = new ImageFixture();
  const f = fixture({ initialController: true, layoutPending: true, deferNavigationModule: true, images: [image] });
  const globalStyle = Object.assign(new Target(), { src: '/src/styles/global.css' });
  const componentStyle = Object.assign(new Target(), { src: '/src/components/Header.astro?astro&type=style&index=0&lang.css' });
  const editor = Object.assign(new Target(), { src: '/src/components/DevTextEditor.astro?astro&type=script&index=0&lang.ts' });
  const query = f.document.querySelectorAll;
  f.document.querySelectorAll = (selector: string) => selector === 'script[type="module"][src]'
    ? [globalStyle, componentStyle, editor] as any : query(selector);
  const source = layout.match(/<head>\s*<!--[\s\S]*?-->\s*<script>([\s\S]*?)<\/script>/)![1];
  const bootstrap = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.replace(/^\s*import .*?;\s*$/gm, '').replace(/import\.meta\.env\.DEV/g, 'true'),
  );
  let initialized = false;
  runInNewContext(bootstrap, {
    document: f.document, location: { href: sourceUrl }, URL, Promise,
    bindSafeVh() {
      initialized = true;
      f.document.documentElement.dataset.introLayoutReady = 'true';
      f.window.emit('vcd:intro-layout-ready');
    },
  });
  await f.paint();
  assert.equal(initialized, false);
  assert.equal(Number(f.overlay.style.opacity), 1);
  globalStyle.emit('load');
  await flush();
  assert.equal(initialized, false);
  componentStyle.emit('load');
  await flush();
  assert.equal(initialized, true);
  assert.equal(editor.count('load') + editor.count('error'), 0);
  assert.equal(image.count('load'), 1);
  assert.equal(Number(f.overlay.style.opacity), 1);
  image.load();
  image.decoded.resolve();
  await f.paint();
  await f.advance(250);
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
  assert.equal(f.persistentHooks, undefined);
});

test('initial reveal keeps the veil opaque until a visible opted-in root is ready', async () => {
  const root = new ReadinessRoot();
  const f = fixture({ initialController: true, layoutPending: true, readinessRoots: [root] });
  await f.paint();
  f.document.documentElement.dataset.introLayoutReady = 'true';
  f.window.emit('vcd:intro-layout-ready');
  await f.paint();
  assert.equal(Number(f.overlay.style.opacity), 1);
  root.dataset.pageRevealReady = 'true';
  root.emit('vcd:page-reveal-ready');
  await f.paint();
  await f.advance(250);
  assert.equal(f.overlay.hidden, true);
});

for (const initialController of [false, true]) {
  test(`${initialController ? 'inline' : 'deferred'} reveal waits for requested faces without waiting for FontFaceSet.ready`, async () => {
    const requested = deferred();
    let unusedReads = 0;
    const unused = { status: 'unloaded', get loaded() { unusedReads++; return new Promise<void>(() => {}); } } as any;
    const f = fixture({
      initialController,
      fontSetReady: new Promise<void>(() => {}),
      fontFaces: [{ status: 'loading', loaded: requested.promise }, unused],
    });
    let syncs = 0;
    f.window.addEventListener('vcd:intro-layout-sync', () => {
      assert.equal(f.animations.length, 0);
      assert.equal(f.marks.some((mark) => mark.name === 'vcd:initial-fade-start'), false);
      syncs++;
    });
    await f.paint();
    assert.equal(unusedReads, 0);
    assert.equal(f.animations.length, 0);
    assert.equal(f.tweens.length, 0);
    assert.equal(syncs, 0);
    requested.resolve();
    await flush();
    await f.paint();
    assert.equal(unusedReads, 0);
    if (initialController) {
      await f.advance(250);
      assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
    } else {
      assert.equal(f.animations.length, 1);
      await f.finishReveal();
    }
    assert.equal(syncs, 1);
    assert.ok(f.bodyReads > 0);
  });
}

test('cached content uses the native incoming fade and approved GSAP outgoing cover', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.tweens.length, 0);
  await f.frame();
  assert.equal(f.tweens.length, 0);
  await f.frame();
  assert.equal(f.tweens.length, 0);
  assert.equal(f.upgrades, 0);
  await f.frame();
  assert.equal(f.upgrades, 0);
  await f.frame();
  assert.equal(f.upgrades, 1);
  assert.equal(f.readinessMarker.hidden, true);
  assert.equal(f.animations.length, 1);
  await f.finishReveal();
  assert.equal(f.overlay.hidden, true);
  f.click();
  assert.equal(f.overlay.hidden, false);
  for (const tween of f.tweens) {
    assert.equal(tween.vars.duration, 0.25);
    assert.equal(tween.vars.ease, 'power1.out');
    assert.equal(typeof gsap.parseEase(tween.vars.ease), 'function');
  }
  assert.equal(f.tweens[0].vars.opacity, 1);
});

test('navigation readiness waits for opted-in roots, ignores offscreen roots, and cleans up on cancel', async () => {
  const pending = new ReadinessRoot();
  const f = fixture({ readinessRoots: [pending] });
  await f.paint();
  assert.equal(f.animations.length, 0);
  assert.equal(pending.count('vcd:page-reveal-ready'), 1);
  pending.dataset.pageRevealReady = 'true';
  pending.emit('vcd:page-reveal-ready');
  await f.paint();
  assert.equal(f.animations.length, 1);
  const ready = new ReadinessRoot(); ready.dataset.pageRevealReady = 'true';
  const offscreen = new ReadinessRoot(false);
  const immediate = fixture({ readinessRoots: [ready, offscreen] });
  await immediate.paint();
  assert.equal(immediate.animations.length, 1);
  assert.equal(offscreen.count('vcd:page-reveal-ready'), 0);
  const cancelledRoot = new ReadinessRoot();
  const cancelled = fixture({ readinessRoots: [cancelledRoot] });
  await cancelled.paint();
  assert.equal(cancelledRoot.count('vcd:page-reveal-ready'), 1);
  cancelled.click();
  assert.equal(cancelledRoot.count('vcd:page-reveal-ready'), 0);
  cancelledRoot.dataset.pageRevealReady = 'true';
  cancelledRoot.emit('vcd:page-reveal-ready');
  await cancelled.paint();
  assert.equal(cancelled.animations.length, 0);
});

test('incoming WAAPI fade completes only when its owned animation finishes', async () => {
  const f = fixture();
  await f.paint();
  assert.equal(f.animations[0].keyframes[0].opacity, 1);
  assert.equal(f.animations[0].keyframes[1].opacity, 0);
  assert.equal(f.animations[0].options.duration, 250);
  assert.equal(f.animations[0].options.easing, 'cubic-bezier(0.25, 0.46, 0.45, 0.94)');
  assert.equal(f.animations[0].options.fill, 'forwards');
  assert.equal(f.overlay.hidden, false);
  await f.advance(250);
  await flush();
  assert.equal(f.overlay.hidden, false);
  assert.equal(Number(f.overlay.style.opacity), 1);
  await f.finishReveal();
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
  assert.equal(f.overlay.style.transition ?? '', '');
});

test('preview upgrades wait for a paint after animation readiness but overlap the active fade', async () => {
  const f = fixture({ deferAnimationReady: true });
  await f.paint();
  assert.equal(f.animations.length, 1);
  assert.equal(f.upgrades, 0);
  f.animations[0].start();
  await flush();
  assert.equal(f.upgrades, 0);
  await f.frame();
  assert.equal(f.upgrades, 0);
  await f.frame();
  assert.equal(f.upgrades, 1);
  assert.equal(f.overlay.hidden, false);
  await f.advance(250);
  assert.equal(f.overlay.hidden, false);
  await f.finishReveal();
  assert.equal(f.overlay.hidden, true);
});

test('slow thumbnail decode gets two fresh opaque-paint frames before the incoming animation runs', async () => {
  const image = new ImageFixture();
  const f = fixture({ images: [image] });
  await f.paint();
  image.load();
  await flush();
  assert.equal(f.animations.length, 0);
  image.decoded.resolve();
  await flush();
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].playState, 'paused');
  await f.frame();
  assert.equal(f.animations[0].playState, 'paused');
  await f.frame();
  assert.equal(f.animations[0].playState, 'running');
  await f.paint();
  await f.finishReveal();
});

test('a delayed paint cannot consume the beginning of the incoming fade', async () => {
  const f = fixture();
  await flush();
  const animation = f.animations[0];
  assert.equal(animation.playState, 'paused');
  await f.advance(98);
  await f.frame();
  assert.equal(animation.currentTime, 0);
  assert.equal(f.overlay.hidden, false);
  assert.equal(Number(f.overlay.style.opacity), 1);
  await f.advance(42);
  await f.frame();
  assert.equal(animation.playState, 'running');
  assert.equal(animation.startTime, 140);
  assert.equal(animation.currentTime, 0);
  await f.advance(125);
  assert.equal(animation.currentTime, 125);
  assert.equal(animation.options.duration, 250);
  await f.paint();
  await f.finishReveal();
});

test('renderer setup after play cannot consume the beginning of the incoming fade', async () => {
  const f = fixture({ deferAnimationReady: true });
  await f.paint();
  const animation = f.animations[0];
  assert.equal(animation.pending, true);
  assert.equal(animation.startTime, null);
  await f.advance(119);
  assert.equal(animation.currentTime, 0);
  assert.equal(f.upgrades, 0);
  assert.equal(f.marks.some(({ name }) => name === 'vcd:veil-fade-start'), false);
  animation.start();
  await flush();
  assert.equal(animation.startTime, 119);
  assert.equal(animation.currentTime, 0);
  await f.advance(125);
  assert.equal(animation.currentTime, 125);
  assert.equal(f.overlay.hidden, false);
  await f.paint();
  await f.finishReveal();
});

test('navigation cancels a staged incoming fade before its first paint', async () => {
  const f = fixture();
  await flush();
  const animation = f.animations[0];
  assert.equal(animation.playState, 'paused');
  f.click();
  await f.paint();
  assert.equal(animation.playState, 'idle');
  assert.equal(animation.playCalls, 0);
  assert.equal(f.upgrades, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.overlay.hidden, false);
});

test('hovered menus start underneath the fully opaque paused veil', async () => {
  const f = fixture();
  let revealTime: number | null = null;
  f.document.addEventListener('header:navigation-reveal', () => {
    revealTime = f.animations[0].currentTime;
    assert.equal(f.animations[0].playState, 'paused');
    assert.equal(Number(f.overlay.style.opacity), 1);
    assert.equal(f.upgrades, 0);
  });
  await f.paint();
  assert.equal(revealTime, 0);
});

test('visible transition upgrade failure still releases the veil', async () => {
  const f = fixture({ visible: true, failUpgrade: true });
  await f.paint();
  assert.equal(f.upgrades, 0);
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(f.overlay.hidden, true);
});

test('animation construction failure still releases the veil', async () => {
  const f = fixture({ failAnimation: true });
  await f.paint();
  assert.equal(f.upgrades, 0);
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(f.overlay.hidden, true);
});

test('canceling before animation readiness cannot open a stale preview gate', async () => {
  const f = fixture({ deferAnimationReady: true });
  await f.paint();
  assert.equal(f.animations.length, 1);
  assert.equal(f.upgrades, 0);
  f.click();
  await flush();
  assert.equal(f.upgrades, 0);
  assert.equal(f.overlay.hidden, false);
  f.tweens[0].finish();
  assert.deepEqual(f.destinations, ['https://vcd.test/about/']);
});

test('navigation cancels the preview paint fence after the fade has started', async () => {
  const f = fixture();
  await flush();
  await f.frame();
  await f.frame();
  assert.equal(f.animations[0].playState, 'running');
  assert.equal(f.upgrades, 0);
  await f.frame();
  f.click();
  await f.frame();
  assert.equal(f.frames.size, 0);
  assert.equal(f.upgrades, 0);
  assert.equal(f.animations[0].playState, 'idle');
  assert.equal(f.overlay.hidden, false);
});

test('canceling an incoming owned animation cannot hide the next page', async () => {
  const f = fixture();
  await f.paint();
  f.click();
  assert.equal(f.overlay.style.transition ?? '', '');
  assert.equal(f.overlay.hidden, false);
  f.overlay.emit('transitionend', { target: f.overlay, propertyName: 'opacity' });
  await flush();
  assert.equal(f.overlay.style.transition ?? '', '');
  assert.equal(f.overlay.hidden, false);
  f.tweens[0].finish();
  assert.deepEqual(f.destinations, ['https://vcd.test/about/']);
});

test('persistent cover starts from a hidden retained veil without snapping', async () => {
  const f = fixture({ initialController: true });
  f.overlay.hidden = true;
  f.overlay.style.opacity = '1';
  const covering = f.persistentHooks.cover();
  assert.equal(Number(f.overlay.style.opacity), 0);
  f.tweens.at(-1)!.finish();
  await covering;
  assert.equal(Number(f.overlay.style.opacity), 1);
});

test('persistent cover preserves a partially visible veil opacity', async () => {
  const f = fixture({ initialController: true });
  f.overlay.hidden = false;
  f.overlay.style.opacity = '0.42';
  const covering = f.persistentHooks.cover();
  assert.equal(Number(f.overlay.style.opacity), 0.42);
  f.tweens.at(-1)!.finish();
  await covering;
  assert.equal(Number(f.overlay.style.opacity), 1);
});

test('initial readiness keeps the activity indicator active until fade authorization', async () => {
  const image = new ImageFixture();
  const f = fixture({ initialController: true, images: [image] });
  assert.equal(f.overlay.dataset.loading, 'true');
  await f.paint();
  assert.equal(f.overlay.dataset.loading, 'true');
  image.load();
  image.decoded.resolve();
  await f.paint();
  assert.equal(f.overlay.dataset.loading, undefined);
});

test('persistent cover activates the activity indicator after covering and retains it during readiness', async () => {
  const image = new ImageFixture();
  const f = fixture({ images: [image] });
  const covering = f.persistentHooks.cover();
  assert.equal(f.overlay.dataset.loading, undefined);
  f.tweens.at(-1)!.finish();
  await covering;
  assert.equal(f.overlay.dataset.loading, 'true');
  f.persistentHooks.reveal();
  await flush();
  assert.equal(f.overlay.dataset.loading, 'true');
  image.load();
  image.decoded.resolve();
  await f.paint();
  assert.equal(f.overlay.dataset.loading, undefined);
});

test('cancellation and pagehide clear the activity indicator', async () => {
  const f = fixture({ images: [new ImageFixture()] });
  assert.equal(f.overlay.dataset.loading, 'true');
  f.click();
  assert.equal(f.overlay.dataset.loading, undefined);

  const restored = fixture({ images: [new ImageFixture()] });
  assert.equal(restored.overlay.dataset.loading, 'true');
  restored.window.emit('pagehide', { persisted: true });
  assert.equal(restored.overlay.dataset.loading, undefined);
});

test('visible transition diagnostics never activate the activity indicator', async () => {
  const f = fixture({ visible: true, images: [new ImageFixture()] });
  assert.equal(f.overlay.dataset.loading, undefined);
  await f.paint();
  assert.equal(f.overlay.dataset.loading, undefined);
});

for (const options of [{ noReadinessMarker: true }, { visible: true }, { failTween: true }, { failUpgrade: true }]) {
  test(`menu reveal notification starts with unveiling, after readiness: ${JSON.stringify(options)}`, async () => {
    const image = new ImageFixture();
    const f = fixture({ ...options, images: [image] });
    const notices: Array<{ opacity: number; tweens: number }> = [];
    f.document.addEventListener('header:navigation-reveal', () => {
      notices.push({ opacity: Number(f.overlay.style.opacity), tweens: f.tweens.length });
    });
    await f.paint();
    assert.equal(notices.length, 0);
    image.load(); image.decoded.resolve(); await flush(); await f.paint();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].tweens, 0);
    if (!options.visible) assert.equal(notices[0].opacity, 1);
    if (options.visible || options.failUpgrade) assert.equal(Number(f.overlay.style.opacity), 0);
    else assert.equal(Number(f.overlay.style.opacity), 1);
  });
}

for (const options of [
  {}, { initialController: true }, { visible: true }, { failTween: true }, { failUpgrade: true },
]) {
  test(`destination reveal notifies carried menus only after the veil is uncovered: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    let completions = 0;
    f.window.addEventListener('vcd:initial-reveal-complete', () => {
      completions++;
      assert.equal(Number(f.overlay.style.opacity), 0);
      assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
    });
    await f.paint();
    await f.paint();
    if (f.animations.length && !options.failUpgrade) {
      assert.equal(completions, 0);
      await f.finishReveal();
    }
    await f.advance(250);
    assert.equal(completions, 1);
  });
}

test('full-document fallback navigates after its 250ms cover without waiting for the header title', async () => {
  const f = fixture();
  await f.paint();
  await f.finishReveal();
  f.click();
  assert.equal(f.destinations.length, 0);
  f.tweens[0].finish();
  assert.deepEqual(f.destinations, ['https://vcd.test/about/']);
});

test('early initial controller reveals once and deferred module adopts its state', async () => {
  const f = fixture({ initialController: true });
  await f.paint();
  await f.paint();
  await f.advance(250);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
  assert.equal(f.overlay.hidden, true);
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(f.overlay.style.transition ?? '', '');
  assert.equal(f.tweens.length, 0);
  assert.equal(f.upgrades, 1);
  assert.ok(f.marks.some((mark) => mark.name === 'vcd:initial-readiness-start'));
  assert.ok(f.marks.some((mark) => mark.name === 'vcd:initial-readiness-satisfied'));
  assert.ok(f.marks.some((mark) => mark.name === 'vcd:initial-fade-start'));
  assert.ok(f.marks.some((mark) => mark.name === 'vcd:initial-fade-end'));
});

test('inline reveal waits for viewport thumbnail decode before fading', async () => {
  const image = new ImageFixture();
  image.complete = true;
  image.naturalWidth = 300;
  const f = fixture({ initialController: true, images: [image] });
  await f.paint();
  await f.paint();
  await f.advance(250);
  assert.equal(image.decodeCalls, 1);
  assert.notEqual(f.overlay.dataset.vcdInitialReveal, 'complete');
  assert.equal(Number(f.overlay.style.opacity), 1);
  image.decoded.resolve();
  await flush();
  await f.paint();
  await f.paint();
  await f.advance(250);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('initial page stays covered until intro spacing is ready', async () => {
  const f = fixture({ initialController: true, intro: true });
  await f.paint();
  await f.advance(500);
  assert.equal(Number(f.overlay.style.opacity), 1);
  f.window.emit('vcd:intro-layout-ready');
  await f.paint();
  await f.paint();
  await f.advance(250);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
});

for (const initialController of [false, true]) {
  test(`${initialController ? 'inline' : 'deferred'} first load waits for layout on a page without an intro block`, async () => {
    const image = new ImageFixture();
    image.rect = { top: 0, left: 0, bottom: 0, right: 100 };
    const f = fixture({ initialController, layoutPending: true, images: [image] });
    await f.paint();
    assert.equal(image.count('load') + image.count('error'), 0);
    image.rect = { top: 0, left: 0, bottom: 100, right: 100 };
    f.window.emit('vcd:intro-layout-ready');
    await flush();
    assert.equal(image.loading, 'eager');
    assert.equal(image.count('load'), 1);
    image.load();
    image.decoded.resolve();
    await flush();
    await f.paint();
    await f.paint();
    if (initialController) await f.advance(250);
    assert.equal(f.overlay.hidden, initialController ? true : false);
  });
}

test('inline readiness selects thumbnails after intro layout settles', async () => {
  const image = new ImageFixture(false);
  const f = fixture({ initialController: true, intro: true, images: [image] });
  await f.paint();
  assert.equal(image.count('load') + image.count('error'), 0);
  image.rect = { top: 0, left: 0, bottom: 100, right: 100 };
  f.window.emit('vcd:intro-layout-ready');
  await flush();
  assert.equal(image.loading, 'eager');
  assert.equal(image.count('load'), 1);
  image.load();
  image.decoded.resolve();
  await f.paint();
  await f.paint();
  await f.advance(250);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
});

test('inline readiness drops thumbnails that move out of view before layout settles', async () => {
  const image = new ImageFixture();
  const f = fixture({ initialController: true, intro: true, images: [image] });
  await f.paint();
  image.rect = { top: 900, left: 0, bottom: 1000, right: 100 };
  f.window.emit('vcd:intro-layout-ready');
  await f.paint();
  await f.paint();
  await f.advance(250);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
  assert.equal(image.count('load') + image.count('error'), 0);
});

test('inline readiness ignores hidden and clipped thumbnails while eagerly loading visible ones', async () => {
  const visible = new ImageFixture();
  const hidden = new ImageFixture();
  hidden.style.visibility = 'hidden';
  const clipped = new ImageFixture();
  clipped.rect = { top: 0, left: 1190, bottom: 100, right: 1290 };
  clipped.parentElement = new ContainerFixture({ top: 0, left: 0, bottom: 100, right: 1100 }, { overflowX: 'hidden' });
  const f = fixture({ initialController: true, intro: true, images: [visible, hidden, clipped] });
  await f.paint();
  f.window.emit('vcd:intro-layout-ready');
  await flush();
  assert.equal(visible.loading, 'eager');
  assert.equal(visible.count('load'), 1);
  assert.equal(hidden.count('load') + hidden.count('error'), 0);
  assert.equal(clipped.count('load') + clipped.count('error'), 0);
});

test('active Home intro reveals after layout and two paints without underlying image readiness', async () => {
  const image = new ImageFixture();
  const f = fixture({ initialController: true, intro: true, homeIntro: { state: 'active' }, images: [image] });
  await f.paint();
  f.window.emit('vcd:intro-layout-ready');
  await f.paint();
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'running');
  await f.advance(250);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
  assert.equal(image.decodeCalls, 0);
});

test('browser trace marks are emitted without the DEV readiness marker', async () => {
  const f = fixture({ noReadinessMarker: true });
  await f.paint();
  assert.ok(f.marks.some((mark) => mark.name === 'vcd:transition-script-start'));
  assert.ok(f.marks.some((mark) => mark.name === 'vcd:fonts-ready'));
  assert.ok(f.marks.some((mark) => mark.name === 'vcd:readiness-satisfied'));
  assert.equal(f.window.count('vcd:transition-milestone'), 0);
});

test('readiness trace detail reports resource completion after a delayed image', async () => {
  const image = new ImageFixture();
  const f = fixture({ images: [image] });
  await f.paint();
  image.load();
  image.decoded.resolve();
  await flush();
  await f.paint();
  const readinessMark = f.marks.find((mark) => mark.name === 'vcd:readiness-satisfied');
  assert.equal(readinessMark?.options?.detail?.release, 'resources');
});

test('visible mode exposes content while stalled, then marks the normal fade boundary once without entry tween', async () => {
  const image = new ImageFixture();
  const f = fixture({ visible: true, images: [image] });
  await f.paint();
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(f.readinessMarker.hidden, true);
  assert.equal(f.upgrades, 0);
  assert.equal(f.tweens.length, 0);
  image.load();
  image.decoded.resolve();
  await f.paint();
  await f.paint();
  assert.equal(f.readinessMarker.hidden, false);
  assert.equal(f.upgrades, 1);
  assert.equal(f.tweens.length, 0);
  await f.paint();
  assert.equal(f.readinessMarker.hidden, false);
  assert.equal(f.upgrades, 1);
});

test('visible mode remains gated beyond four seconds until media is ready', async () => {
  const image = new ImageFixture();
  const f = fixture({ visible: true, images: [image] });
  await f.paint();
  await f.advance(4001);
  assert.equal(f.readinessMarker.hidden, true);
  image.load();
  image.decoded.resolve();
  await f.paint();
  assert.equal(f.readinessMarker.hidden, false);
  assert.equal(f.upgrades, 1);
  assert.equal(f.tweens.length, 0);
});

test('visible internal navigation skips outgoing tween and carries the diagnostic query', () => {
  const f = fixture({ visible: true });
  assert.equal(f.click().defaultPrevented, true);
  assert.equal(f.tweens.length, 0);
  assert.deepEqual(f.destinations, ['https://vcd.test/about/?dev-transition=visible']);
});

test('visible BFCache restore hides and re-shows the readiness marker once', async () => {
  const f = fixture({ visible: true });
  await f.paint();
  assert.equal(f.readinessMarker.hidden, false);
  f.window.emit('pagehide', { persisted: true });
  f.window.emit('pageshow', { persisted: true });
  assert.equal(f.readinessMarker.hidden, true);
  await f.paint();
  assert.equal(f.readinessMarker.hidden, false);
  assert.equal(f.upgrades, 2);
  assert.equal(f.tweens.length, 0);
});

test('visible readiness marker remains dev-only in Layout output', () => {
  assert.match(layout, /showDevTools[\s\S]*data-dev-transition/);
  assert.match(layout, /showDevTools[\s\S]*transition-readiness-marker/);
  assert.match(layout, /html\[data-dev-transition="visible"\]/);
  assert.match(layout, /dev-transition[^\n]*visible/);
});

test('fonts and visible decoded thumbnails gate reveal; offscreen images do not', async () => {
  const fonts = deferred();
  const visible = new ImageFixture();
  const offscreen = new ImageFixture(false);
  const f = fixture({ fonts: fonts.promise, images: [visible, offscreen] });
  await f.paint();
  assert.equal(Number(f.overlay.style.opacity), 1);
  assert.equal(f.overlay.style.transition ?? '', '');
  assert.equal(visible.decodeCalls, 0);
  visible.load();
  await flush();
  assert.equal(visible.decodeCalls, 1);
  await flush();
  assert.equal(f.tweens.length, 0);
  fonts.resolve();
  await flush();
  visible.decoded.resolve();
  await flush();
  await f.paint();
  assert.equal(f.tweens.length, 0);
  assert.equal(f.animations.length, 1);
  assert.equal(Number(f.overlay.style.opacity), 1);
  await f.finishReveal();
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(offscreen.count('load'), 0);
  assert.equal(offscreen.decodeCalls, 0);
  assert.equal(visible.count('load') + visible.count('error'), 0);
  assert.equal(visible.loading, 'eager');
});

for (const initialController of [false, true]) {
  test(`${initialController ? 'inline' : 'deferred'} readiness waits for visible regular images to load, decode, and paint`, async () => {
    const visible = new ImageFixture();
    visible.preview = false;
    const hidden = new ImageFixture();
    hidden.preview = false;
    hidden.style.visibility = 'hidden';
    const offscreen = new ImageFixture(false);
    offscreen.preview = false;
    const clipped = new ImageFixture();
    clipped.preview = false;
    clipped.rect = { top: 0, left: 1190, bottom: 100, right: 1290 };
    clipped.parentElement = new ContainerFixture({ top: 0, left: 0, bottom: 100, right: 1100 }, { overflowX: 'hidden' });
    const f = fixture({ initialController, images: [visible, hidden, offscreen, clipped] });
    await f.paint();
    assert.equal(visible.loading, 'eager');
    assert.equal(visible.count('load'), 1);
    assert.equal(hidden.count('load') + hidden.count('error'), 0);
    assert.equal(offscreen.count('load') + offscreen.count('error'), 0);
    assert.equal(clipped.count('load') + clipped.count('error'), 0);
    visible.load();
    await flush();
    assert.equal(visible.decodeCalls, 1);
    if (initialController) assert.equal(Number(f.overlay.style.opacity), 1);
    assert.equal(f.animations.length, 0);
    visible.decoded.resolve();
    await flush();
    if (initialController) {
      await f.frame();
      assert.equal(Number(f.overlay.style.opacity), 1);
      await f.frame();
      await f.advance(250);
      assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
    } else {
      assert.equal(f.animations.length, 1);
      assert.equal(f.animations[0].playState, 'paused');
      await f.frame();
      assert.equal(f.animations[0].playState, 'paused');
      await f.frame();
      assert.equal(f.animations[0].playState, 'running');
      await f.paint();
      await f.finishReveal();
      assert.equal(f.overlay.hidden, true);
    }
  });

  test(`${initialController ? 'inline' : 'deferred'} readiness releases on a regular image error`, async () => {
    const broken = new ImageFixture();
    broken.preview = false;
    const f = fixture({ initialController, images: [broken] });
    await f.paint();
    assert.equal(broken.loading, 'eager');
    broken.fail();
    await flush();
    if (initialController) {
      await f.paint();
      await f.advance(250);
      assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
    } else {
      assert.equal(f.animations.length, 1);
      await f.paint();
      await f.finishReveal();
      assert.equal(f.overlay.hidden, true);
    }
  });
}

for (const initialController of [false, true]) {
  test(`${initialController ? 'inline' : 'deferred'} readiness uses the owning crop frame for unloaded thumbnails`, async () => {
    const visible = new ImageFixture();
    visible.rect = { top: 0, left: 0, bottom: 0, right: 100 };
    visible.frame = new ContainerFixture({ top: 0, left: 0, bottom: 160, right: 100 }, { overflow: 'hidden' });
    visible.parentElement = visible.frame;
    const offscreen = new ImageFixture();
    offscreen.rect = { top: 0, left: 0, bottom: 0, right: 100 };
    offscreen.frame = new ContainerFixture({ top: 900, left: 0, bottom: 1060, right: 100 });
    offscreen.parentElement = offscreen.frame;
    const f = fixture({ initialController, images: [visible, offscreen] });
    await f.paint();
    assert.equal(visible.loading, 'eager');
    assert.equal(visible.count('load'), 1);
    assert.equal(offscreen.count('load') + offscreen.count('error'), 0);
    visible.load();
    assert.equal(visible.loading, 'eager');
    await flush();
    assert.equal(visible.decodeCalls, 1);
    assert.equal(f.animations.length, 0);
    visible.decoded.resolve();
    await flush();
    if (initialController) {
      await f.frame();
      assert.equal(Number(f.overlay.style.opacity), 1);
      await f.frame();
      await f.advance(250);
      assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
    } else {
      assert.equal(f.animations.length, 1);
      assert.equal(f.animations[0].playState, 'paused');
      await f.frame();
      assert.equal(f.animations[0].playState, 'paused');
      await f.frame();
      assert.equal(f.animations[0].playState, 'running');
    }
  });
}

for (const initialController of [false, true]) {
  test(`${initialController ? 'inline' : 'deferred'} readiness ignores visible media behind an active home intro`, async () => {
    const introImage = new ImageFixture();
    const underlyingImage = new ImageFixture();
    const f = fixture({ initialController, homeIntro: { images: [introImage] }, images: [introImage, underlyingImage] });
    await f.paint();
    assert.equal(introImage.count('load'), 1);
    assert.equal(underlyingImage.count('load') + underlyingImage.count('error'), 0);
    introImage.load();
    introImage.decoded.resolve();
    await f.paint();
    await f.paint();
    await f.advance(250);
    assert.equal(f.upgrades, 1);
  });

  test(`${initialController ? 'inline' : 'deferred'} readiness still gates on images inside an active home intro`, async () => {
    const introImage = new ImageFixture();
    const f = fixture({ initialController, homeIntro: { images: [introImage] }, images: [introImage] });
    await f.paint();
    assert.equal(f.upgrades, 0);
    introImage.load();
    introImage.decoded.resolve();
    await f.paint();
    await f.paint();
    await f.advance(250);
    assert.equal(f.upgrades, 1);
  });

  test(`${initialController ? 'inline' : 'deferred'} readiness restores all media gates after intro dismissal`, async () => {
    const introImage = new ImageFixture();
    const underlyingImage = new ImageFixture();
    const f = fixture({ initialController, homeIntro: { state: 'dismissed', images: [introImage] }, images: [introImage, underlyingImage] });
    await f.paint();
    assert.equal(introImage.count('load'), 1);
    assert.equal(underlyingImage.count('load'), 1);
  });
}

test('stalled media remains covered beyond four seconds and releases after readiness', async () => {
  const stalled = new ImageFixture();
  const f = fixture({ images: [stalled] });
  await f.paint();
  await f.advance(4001);
  assert.equal(f.tweens.length, 0);
  await f.paint();
  assert.equal(f.tweens.length, 0);
  assert.equal(stalled.count('load'), 1);
  assert.equal(f.animations.length, 0);
  assert.equal(Number(f.overlay.style.opacity), 1);
  stalled.load();
  stalled.decoded.resolve();
  await flush();
  await f.paint();
  assert.equal(f.animations.length, 1);
  await f.advance(250);
  assert.equal(f.overlay.hidden, false);
  await f.finishReveal();
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(f.timers.size, 0);
});

test('inline stalled media remains covered beyond four seconds', async () => {
  const stalled = new ImageFixture();
  const f = fixture({ initialController: true, images: [stalled] });
  await f.paint();
  await f.advance(4001);
  await f.paint();
  await f.paint();
  assert.equal(Number(f.overlay.style.opacity), 1);
  assert.equal(f.marks.some((mark) => mark.name === 'vcd:initial-fade-start'), false);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'running');
  stalled.load();
  stalled.decoded.resolve();
  await flush();
  await f.paint();
  await f.paint();
  await f.advance(250);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
});

test('broken images, rejected decodes and rejected fonts fail open', async () => {
  const broken = new ImageFixture();
  const rejected = new ImageFixture();
  const fonts = deferred();
  const f = fixture({ fonts: fonts.promise, images: [broken, rejected] });
  await f.paint();
  broken.fail();
  rejected.load();
  await flush();
  rejected.decoded.reject(new Error('decode failed'));
  fonts.reject(new Error('fonts failed'));
  await flush();
  await f.paint();
  assert.equal(f.tweens.length, 0);
  assert.equal(f.animations.length, 1);
  assert.equal(Number(f.overlay.style.opacity), 1);
  await f.finishReveal();
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('navigation during readiness cancels image listeners, timeout and pending paint', async () => {
  const fonts = deferred();
  const image = new ImageFixture();
  const f = fixture({ fonts: fonts.promise, images: [image] });
  assert.equal(f.click().defaultPrevented, true);
  f.tweens[0].finish();
  assert.equal(image.count('load') + image.count('error'), 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 1);
  fonts.resolve(); image.load(); image.decoded.resolve();
  await f.paint();
  await f.advance(4000);
  assert.equal(f.tweens.length, 1);
  assert.equal(f.upgrades, 0);
  await f.finishReveal();
  assert.deepEqual(f.destinations, ['https://vcd.test/about/']);
});

test('rapid clicks keep the first destination and interrupt entry at its rendered opacity', async () => {
  const f = fixture();
  await f.paint();
  f.overlay.style.opacity = '0.4';
  f.click(0);
  assert.equal(f.click(1).defaultPrevented, true, 'A competing destination must not navigate natively');
  assert.equal(f.click(0).defaultPrevented, true);
  assert.equal(f.overlay.style.transition ?? '', '');
  assert.equal(f.tweens.length, 1);
  assert.equal(f.tweens[0].startOpacity, 0.4);
  assert.equal(f.click(1).defaultPrevented, true);
  assert.equal(f.tweens.length, 1);
  f.tweens[0].finish();
  assert.deepEqual(f.destinations, ['https://vcd.test/about/']);
});

test('pagehide cancels callbacks; bfcache restore replays readiness and unlocks navigation', async () => {
  const f = fixture();
  f.click();
  const staleExit = f.tweens[0];
  f.window.emit('pagehide', { persisted: true });
  staleExit.vars.onComplete();
  assert.equal(f.click(1).defaultPrevented, true);
  assert.deepEqual(f.destinations, []);
  assert.equal(f.tweens.length, 1);
  f.window.emit('pageshow', { persisted: true });
  assert.equal(Number(f.overlay.style.opacity), 1);
  await f.paint();
  const restoredEntry = f.tweens.at(-1);
  assert.equal(restoredEntry?.vars.opacity, 1);
  await f.finishReveal();
  await flush();
  staleExit.vars.onComplete();
  f.click(1);
  f.tweens.at(-1).finish();
  assert.deepEqual(f.destinations, ['https://vcd.test/play/']);
});

test('stale decode and font completions after restore cannot start an extra reveal', async () => {
  const image = new ImageFixture();
  image.complete = true;
  image.naturalWidth = 300;
  const fonts = deferred();
  const f = fixture({ images: [image], fonts: fonts.promise });
  await f.paint();
  f.window.emit('pagehide', { persisted: true });
  f.window.emit('pageshow', { persisted: true });
  await f.paint();
  image.decoded.resolve(); fonts.resolve();
  await flush();
  await f.paint();
  assert.equal(f.tweens.length, 0);
  assert.equal(f.upgrades, 1);
});

test('ordinary pageshow does not restart entry', async () => {
  const f = fixture();
  f.window.emit('pageshow', { persisted: false });
  await f.paint();
  assert.equal(f.tweens.length, 0);
});

for (const properties of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
  test(`native click semantics: ${JSON.stringify(properties)}`, () => {
    const f = fixture();
    f.click(0, properties);
    assert.equal(f.tweens.length, 0);
    assert.deepEqual(f.destinations, []);
  });
}

for (const attributes of [
  { href: '/work/#main-content' }, { href: '#main-content' }, { href: '/about/#contact' },
  { href: 'https://external.test/' }, { href: 'https://vcd.test.evil.test/' },
  { href: 'mailto:test@example.test' }, { href: 'http://[' }, { href: '' },
  { target: '_blank' }, { target: 'other-window' }, { download: '' },
]) {
  test(`current anchor attributes remain native: ${JSON.stringify(attributes)}`, () => {
    const f = fixture();
    Object.assign(f.anchors[0].attributes, attributes);
    assert.equal(f.click().defaultPrevented, false);
    assert.equal(f.tweens.length, 0);
  });
}

test('Edit-mode href removal is native; restoring href and Enter use the latest destination', () => {
  const f = fixture();
  f.anchors[0].removeAttribute('href');
  assert.equal(f.click().defaultPrevented, false);
  f.anchors[0].setAttribute('href', '/play/');
  f.anchors[0].setAttribute('target', '_self');
  assert.equal(f.click(0, { detail: 0 }).defaultPrevented, true);
  f.tweens[0].finish();
  assert.deepEqual(f.destinations, ['https://vcd.test/play/']);
});

test('missing overlay opens previews and leaves links native', () => {
  const f = fixture({ noOverlay: true });
  assert.equal(f.bound, 1);
  assert.equal(f.upgrades, 1);
  assert.equal(f.click().defaultPrevented, false);
  assert.equal(f.tweens.length, 0);
});

test('reduced motion retains the same opacity fades', async () => {
  const f = fixture({ reduced: true });
  await f.paint();
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].options.duration, 250);
  await f.finishReveal();
  f.click();
  assert.deepEqual(f.tweens.map((t) => [t.vars.opacity, t.vars.duration, t.vars.ease]), [[1, 0.25, 'power1.out']]);
});

test('canceled or stalled navigation recovers and accepts a fresh destination', async () => {
  const f = fixture();
  await f.paint();
  await f.finishReveal();
  f.click();
  f.tweens.at(-1).finish();
  await f.advance(4000);
  await f.paint();
  await f.finishReveal();
  await flush();
  f.click(1);
  f.tweens.at(-1).finish();
  assert.deepEqual(f.destinations, ['https://vcd.test/about/', 'https://vcd.test/play/']);
});

test('successful navigation pagehide clears its recovery timer', async () => {
  const f = fixture();
  f.click(); f.tweens[0].finish();
  f.window.emit('pagehide', { persisted: true });
  assert.equal(f.timers.size, 0);
  await f.advance(4000);
  await f.paint();
  assert.equal(f.tweens.length, 1);
});

test('incoming reveal does not depend on GSAP tween availability', async () => {
  const f = fixture({ failTween: true });
  await f.paint();
  assert.equal(f.animations.length, 1);
  await f.finishReveal();
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('preview upgrade failure does not strand the veil', async () => {
  const f = fixture({ failUpgrade: true });
  await f.paint();
  await f.finishReveal();
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('a decode implementation throwing synchronously still releases readiness', async () => {
  const image = new ImageFixture();
  image.complete = true;
  image.naturalWidth = 300;
  image.decode = () => { throw new Error('decode unavailable'); };
  const f = fixture({ images: [image] });
  await f.paint();
  await f.finishReveal();
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('navigation cancels the second opaque-paint frame', async () => {
  const f = fixture();
  await f.frame();
  assert.equal(f.frames.size, 1);
  f.click();
  assert.equal(f.frames.size, 0);
  await f.paint();
  assert.equal(f.tweens.length, 1);
  assert.equal(f.tweens[0].vars.opacity, 1);
});

test('late decode from interrupted entry cannot open the preview gate during exit', async () => {
  const image = new ImageFixture();
  const f = fixture({ images: [image] });
  await f.paint(); image.load(); await flush();
  assert.equal(image.decodeCalls, 1);
  f.click(); image.decoded.resolve(); await flush();
  assert.equal(f.upgrades, 0);
  assert.equal(f.tweens.length, 1);
});

test('outgoing tween failure still follows the accepted link', () => {
  const f = fixture({ failTween: true });
  assert.equal(f.click().defaultPrevented, true);
  assert.deepEqual(f.destinations, ['https://vcd.test/about/']);
});

test('synchronous navigation failure restores content and unlocks the next attempt', async () => {
  const f = fixture({ failNavigation: true });
  f.click(); f.tweens[0].finish(); await f.paint();
  await f.finishReveal();
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(f.timers.size, 0);
  f.click(1);
  assert.equal(f.tweens.at(-1).vars.opacity, 1);
});

test('the no-JavaScript CSS safety reveal remains available after five seconds', () => {
  const css = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
  const critical = layout.match(/<style is:inline>\s*\/\* Cover the first paint[\s\S]*?<\/style>/)?.[0] ?? '';
  const noscript = layout.match(/<noscript set:html=\{'([^']+)'\}><\/noscript>/)?.[1] ?? '';
  assert.doesNotMatch(critical, /#transition-overlay\s*\{[^}]*animation:/);
  assert.doesNotMatch(css, /#transition-overlay\s*\{[^}]*animation:/);
  assert.match(noscript, /animation: transition-overlay-reveal[^;]* 5s forwards/);
  assert.match(critical, /@keyframes transition-overlay-reveal\s*\{\s*to\s*\{\s*opacity: 0;/);
});

for (const initialController of [false, true]) {
  test(`${initialController ? 'inline' : 'deferred'} reveal stays covered until fonts are ready`, async () => {
    const fonts = deferred();
    const f = fixture({ initialController, fonts: fonts.promise });
    await f.paint();
    await f.paint();
    assert.equal(Number(f.overlay.style.opacity), 1);
    assert.equal(f.animations.length, 0);
    assert.equal(f.marks.some((mark) => mark.name === 'vcd:initial-fade-start'), false);
    fonts.resolve();
    await flush();
    await f.paint();
    await f.paint();
    if (initialController) {
      assert.equal(Number(f.overlay.style.opacity), 0);
      await f.advance(250);
      assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
    } else {
      assert.equal(f.tweens.length, 0);
      await f.finishReveal();
      assert.equal(Number(f.overlay.style.opacity), 0);
    }
    const reveals = f.upgrades;
    await f.paint();
    assert.equal(f.upgrades, reveals);
  });
  test(`${initialController ? 'inline' : 'deferred'} font failure releases the veil`, async () => {
    const fonts = deferred();
    const f = fixture({ initialController, fonts: fonts.promise });
    await f.paint();
    assert.equal(Number(f.overlay.style.opacity), 1);
    fonts.reject(new Error('font unavailable'));
    await f.paint();
    if (initialController) {
      await f.advance(250);
      assert.equal(f.overlay.dataset.vcdInitialReveal, 'complete');
    } else {
      await f.finishReveal();
      assert.equal(Number(f.overlay.style.opacity), 0);
    }
  });
}

test('navigation during the inline fade keeps the outgoing veil visible', async () => {
  const f = fixture({ initialController: true });
  await f.paint();
  await f.paint();
  f.click();
  await f.advance(250);
  assert.equal(f.overlay.hidden, false);
  assert.equal(f.overlay.dataset.vcdInitialReveal, 'cancelled');
});
