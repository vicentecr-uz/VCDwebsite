import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'bun:test';
import gsap from 'gsap';

const layout = readFileSync(process.env.LAYOUT_TEST_SOURCE ?? new URL('../../src/layouts/Layout.astro', import.meta.url), 'utf8');
const timeline = readFileSync(new URL('../../src/components/DevTransitionTimeline.astro', import.meta.url), 'utf8');
test('timeline capture initializes inline before the Layout transition module', () => {
  assert.match(timeline, /<script is:inline>/);
  assert.ok(layout.indexOf('<DevTransitionTimeline />') < layout.indexOf("import gsap from 'gsap'"));
  assert.match(layout, /data-transition-image-index/);
  assert.match(layout, /data-transition-thumb-src/);
  assert.match(layout, /data-transition-preview-src/);
  assert.match(timeline, /data-transition-image-index/);
  assert.doesNotMatch(timeline.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1] ?? '', /\bas\s+(?:Window|CustomEvent|HTML)|:\s*Record<|querySelector(?:All)?</);
  assert.match(timeline, /data-transition-toggle-fade[\s\S]*aria-pressed/);
  assert.match(timeline, /localStorage[\s\S]*fadeStartMs[\s\S]*navigator\.clipboard/);
  assert.match(timeline, /fontsReadyAt[\s\S]*--font-sans[\s\S]*system-ui/);
});
const script = [...layout.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).find((source) => source.includes("import gsap from 'gsap'"));
assert.ok(script, 'Exercise the actual Layout transition script');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.replace(/^\s*import .*?;\s*$/gm, ''));

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
  decodeCalls = 0;
  decoded = deferred();
  parentElement: ContainerFixture | null = null;
  preview = true;
  style: Record<string, string> = {};
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
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function fixture(options: { images?: ImageFixture[]; fonts?: Promise<void>; noOverlay?: boolean; reduced?: boolean; visible?: boolean; failTween?: boolean; failUpgrade?: boolean; failNavigation?: boolean } = {}) {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: Function }>();
  const frames = new Map<number, Function>();
  const overlay = { style: { opacity: '1', animation: '', removeProperty(name: string) { delete (this as any)[name]; } } };
  const readinessMarker = { hidden: true };
  const anchors = [new Anchor('/about/'), new Anchor('/play/')];
  const document = Object.assign(new Target(), {
    images: options.images ?? [], fonts: { ready: options.fonts ?? Promise.resolve() },
    documentElement: { clientHeight: 800, clientWidth: 1200, dataset: options.visible ? { devTransition: 'visible' } : {} },
    getElementById: (id: string) => id === 'transition-readiness-marker' ? readinessMarker : (options.noOverlay ? null : overlay),
    querySelectorAll: (selector: string) => selector === 'img[data-image-preview]'
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
  const tweens: any[] = [];
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
    set(target: any, values: any) { Object.assign(target.style, values); },
  };
  runInNewContext(compiled, {
    document, window, location, URL, AbortController, Promise,
    CustomEvent: class { constructor(public type: string, public init: any = {}) {} get detail() { return this.init.detail; } }, performance: { now: () => 0 },
    setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
    gsap: fakeGsap, bindSafeVh() {}, bindImagePreviewUpgrade() { bound++; },
    openImagePreviewUpgrade() { if (options.failUpgrade) throw new Error('upgrade unavailable'); upgrades++; },
    getComputedStyle: (element: any) => ({
      opacity: element.style?.opacity ?? overlay.style.opacity,
      display: element.style?.display ?? '', visibility: element.style?.visibility ?? '',
      overflow: element.style?.overflow ?? '', overflowX: element.style?.overflowX ?? '',
      overflowY: element.style?.overflowY ?? '',
    }),
    console: { warn() {}, error() {}, log() {} },
  });
  return {
    overlay, readinessMarker, anchors, window, document, destinations, tweens, frames, timers,
    get upgrades() { return upgrades; }, get bound() { return bound; },
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
    async paint() { await this.frame(); await this.frame(); },
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

test('cached content still gets one opaque paint; both fades use the approved valid 250ms ease', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.tweens.length, 0);
  await f.frame();
  assert.equal(f.tweens.length, 0);
  await f.frame();
  assert.equal(f.tweens.length, 1);
  assert.equal(f.upgrades, 1);
  assert.equal(f.readinessMarker.hidden, true);
  assert.equal(f.timers.size, 0);
  const entry = f.tweens[0];
  entry.finish();
  f.click();
  for (const tween of f.tweens) {
    assert.equal(tween.vars.duration, 0.25);
    assert.equal(tween.vars.ease, 'power1.out');
    assert.equal(typeof gsap.parseEase(tween.vars.ease), 'function');
  }
  assert.equal(f.tweens[1].vars.opacity, 1);
});

test('visible mode exposes content while stalled, then marks the normal fade boundary once without entry tween', async () => {
  const fonts = deferred();
  const f = fixture({ visible: true, fonts: fonts.promise });
  await f.paint();
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(f.readinessMarker.hidden, true);
  assert.equal(f.upgrades, 0);
  assert.equal(f.tweens.length, 0);
  fonts.resolve();
  await f.paint();
  assert.equal(f.readinessMarker.hidden, false);
  assert.equal(f.upgrades, 1);
  assert.equal(f.tweens.length, 0);
  await f.paint();
  assert.equal(f.readinessMarker.hidden, false);
  assert.equal(f.upgrades, 1);
});

test('visible mode fallback marks readiness after four seconds', async () => {
  const f = fixture({ visible: true, fonts: deferred().promise });
  await f.paint();
  await f.advance(3999);
  assert.equal(f.readinessMarker.hidden, true);
  await f.advance(1);
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

test('visible diagnostic is dev-only in Layout output', () => {
  assert.match(layout, /showDevTools[\s\S]*data-dev-transition/);
  assert.match(layout, /showDevTools[\s\S]*transition-readiness-marker/);
  assert.match(layout, /html\[data-dev-transition="visible"\]/);
  assert.match(layout, /dev-transition[^\n]*visible/);
});

test('fonts and visible decoded thumbnails gate reveal; offscreen images never gate it', async () => {
  const fonts = deferred();
  const visible = new ImageFixture();
  const offscreen = new ImageFixture(false);
  const f = fixture({ fonts: fonts.promise, images: [visible, offscreen] });
  await f.paint();
  assert.equal(visible.decodeCalls, 0);
  visible.load();
  await flush();
  assert.equal(visible.decodeCalls, 1);
  fonts.resolve();
  await flush();
  assert.equal(f.tweens.length, 0);
  visible.decoded.resolve();
  await flush();
  assert.equal(f.tweens.length, 1);
  assert.equal(offscreen.count('load'), 0);
  assert.equal(offscreen.decodeCalls, 0);
  assert.equal(visible.count('load') + visible.count('error'), 0);
});

test('only visible progressive thumbnails participate in readiness geometry', async () => {
  const active = new ImageFixture();
  const rawAvatar = new ImageFixture();
  rawAvatar.preview = false;
  const offscreenLoop = new ImageFixture();
  offscreenLoop.parentElement = new ContainerFixture({ top: 900, left: 0, bottom: 1000, right: 1200 }, { overflow: 'hidden' });
  const clippedAdjacent = new ImageFixture();
  clippedAdjacent.rect = { top: 0, left: 1190, bottom: 100, right: 1290 };
  clippedAdjacent.parentElement = new ContainerFixture({ top: 0, left: 0, bottom: 100, right: 1100 }, { overflowX: 'hidden' });
  const hiddenHover = new ImageFixture();
  hiddenHover.style.visibility = 'hidden';
  const f = fixture({ images: [active, rawAvatar, offscreenLoop, clippedAdjacent, hiddenHover] });
  await f.paint();
  assert.equal(active.count('load'), 1);
  assert.equal(rawAvatar.count('load') + rawAvatar.count('error'), 0);
  assert.equal(offscreenLoop.count('load') + offscreenLoop.count('error'), 0);
  assert.equal(clippedAdjacent.count('load') + clippedAdjacent.count('error'), 0);
  assert.equal(hiddenHover.count('load') + hiddenHover.count('error'), 0);
  active.load();
  await flush();
  assert.equal(active.decodeCalls, 1);
  active.decoded.resolve();
  await flush();
  assert.equal(f.tweens.length, 1);
});

test('four-second fallback releases stalled fonts/media and removes losing listeners', async () => {
  const stalled = new ImageFixture();
  const f = fixture({ fonts: deferred().promise, images: [stalled] });
  await f.paint();
  await f.advance(3999);
  assert.equal(f.tweens.length, 0);
  await f.advance(1);
  assert.equal(f.tweens.length, 1);
  assert.equal(stalled.count('load') + stalled.count('error'), 0);
  assert.equal(f.timers.size, 0);
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
  assert.equal(f.tweens.length, 1);
  f.tweens[0].finish();
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('navigation during readiness cancels image listeners, timeout and pending paint', async () => {
  const fonts = deferred();
  const image = new ImageFixture();
  const f = fixture({ fonts: fonts.promise, images: [image] });
  assert.equal(f.click().defaultPrevented, true);
  assert.equal(image.count('load') + image.count('error'), 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  fonts.resolve(); image.load(); image.decoded.resolve();
  await f.paint();
  await f.advance(4000);
  assert.equal(f.tweens.length, 1);
  assert.equal(f.upgrades, 0);
  f.tweens[0].finish();
  assert.deepEqual(f.destinations, ['https://vcd.test/about/']);
});

test('rapid clicks keep the first destination and interrupt entry at its rendered opacity', async () => {
  const f = fixture();
  await f.paint();
  const entry = f.tweens[0];
  f.overlay.style.opacity = '0.4';
  f.click(0);
  assert.equal(f.click(1).defaultPrevented, true, 'A competing destination must not navigate natively');
  assert.equal(f.click(0).defaultPrevented, true);
  assert.equal(entry.killed, true);
  assert.equal(f.tweens.length, 2);
  assert.equal(f.tweens[1].startOpacity, 0.4);
  entry.vars.onComplete?.();
  assert.equal(f.click(1).defaultPrevented, true);
  assert.equal(f.tweens.length, 2);
  f.tweens[1].finish();
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
  assert.equal(restoredEntry.vars.opacity, 0);
  restoredEntry.finish();
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
  assert.equal(f.tweens.length, 1);
  assert.equal(f.upgrades, 1);
});

test('ordinary pageshow does not restart entry', async () => {
  const f = fixture();
  f.window.emit('pageshow', { persisted: false });
  await f.paint();
  assert.equal(f.tweens.length, 1);
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
  f.tweens[0].finish();
  f.click();
  assert.deepEqual(f.tweens.map((t) => [t.vars.opacity, t.vars.duration, t.vars.ease]), [
    [0, 0.25, 'power1.out'], [1, 0.25, 'power1.out'],
  ]);
});

test('canceled or stalled navigation recovers and accepts a fresh destination', async () => {
  const f = fixture();
  await f.paint();
  f.tweens[0].finish();
  f.click();
  f.tweens.at(-1).finish();
  await f.advance(4000);
  await f.paint();
  assert.equal(f.tweens.at(-1).vars.opacity, 0);
  f.tweens.at(-1).finish();
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

test('entry tween failure exposes content instead of stranding the veil', async () => {
  const f = fixture({ failTween: true });
  await f.paint();
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('preview upgrade failure does not strand the veil', async () => {
  const f = fixture({ failUpgrade: true });
  await f.paint();
  f.tweens.at(-1)?.finish();
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('a decode implementation throwing synchronously still releases readiness', async () => {
  const image = new ImageFixture();
  image.complete = true;
  image.naturalWidth = 300;
  image.decode = () => { throw new Error('decode unavailable'); };
  const f = fixture({ images: [image] });
  await f.paint();
  f.tweens.at(-1)?.finish();
  assert.equal(Number(f.overlay.style.opacity), 0);
});

test('navigation cancels the second opaque-paint frame', async () => {
  const f = fixture({ fonts: deferred().promise });
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
  f.tweens.at(-1).finish();
  assert.equal(Number(f.overlay.style.opacity), 0);
  assert.equal(f.timers.size, 0);
  f.click(1);
  assert.equal(f.tweens.at(-1).vars.opacity, 1);
});

test('the no-JavaScript CSS safety reveal remains available after five seconds', () => {
  const css = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(css, /#transition-overlay\s*\{[^}]*opacity: 1;[^}]*animation: transition-overlay-reveal[^;]* 5s forwards;/);
  assert.match(css, /@keyframes transition-overlay-reveal\s*\{\s*to\s*\{\s*opacity: 0;/);
});
