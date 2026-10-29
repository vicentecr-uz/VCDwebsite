import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createHeaderMenuDemo } from '../../src/lib/headerMenuDemo';
import config from '../../src/lib/headerMenuDemoConfig.json';

type Trace = { node: Element; frames: Keyframe[]; duration: number; easing: string; start: number; startTime: number | null; cancelled: boolean };
const restores: Array<() => void> = [];
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
afterEach(() => { restores.splice(0).reverse().forEach(restore => restore()); });

function fixture({ mobile = false, reduced = false, intro = true, gallery = true, reveal = false } = {}) {
  const win = new Window({ url: 'http://localhost:4323/' });
  const doc = win.document;
  let now = 0, nextId = 0, editing = false, hovered = false;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const traces: Trace[] = [];
  const menu: Array<{ open: boolean; time: number }> = [];
  const samples: Array<{ expected: string; actual: string | undefined }> = [];
  let hitOverride: Element | undefined;
  const schedule = (fn: () => void, delay: number) => {
    const id = ++nextId;
    jobs.set(id, { at: now + delay, fn });
    return id;
  };
  win.setTimeout = ((fn: () => void, delay = 0) => schedule(fn, Number(delay))) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => { jobs.delete(Number(id)); }) as typeof win.clearTimeout;
  win.requestAnimationFrame = callback => schedule(() => callback(now), 16);
  win.cancelAnimationFrame = id => { jobs.delete(id); };
  Object.defineProperty(win.performance, 'now', { value: () => now });
  Object.defineProperty(win, 'innerWidth', { value: 1200 });
  Object.defineProperty(win, 'innerHeight', { value: 800 });
  Object.defineProperty(doc, 'hidden', { value: false, configurable: true });
  const media = Object.assign(new win.EventTarget(), { matches: mobile });
  const reduce = Object.assign(new win.EventTarget(), { matches: reduced });
  win.matchMedia = ((query: string) => query.includes('40em') ? media : reduce) as typeof win.matchMedia;
  doc.body.innerHTML = (intro ? '<div data-home-intro-surface data-state="active"></div>' : '')
    + (gallery ? '<div class="project-grid"></div>' : '')
    + (reveal ? '<div data-vcd-initial-reveal="running"></div>' : '')
    + '<div class="site-header__row" style="cursor:auto"><div class="header-trigger header-trigger--start"><div class="header-trigger__panel" style="cursor:auto"><div class="header-trigger__brand" tabindex="-1" style="cursor:default"></div></div></div><div class="header-trigger--end"><div class="header-trigger__panel"></div></div></div><a class="gallery-link" style="cursor:pointer"></a><div class="occluder" style="cursor:grab"></div>';
  const row = doc.querySelector<HTMLElement>('.site-header__row')!;
  const trigger = doc.querySelector<HTMLElement>('.header-trigger--start')!;
  const panel = trigger.querySelector<HTMLElement>('.header-trigger__panel')!;
  const brand = trigger.querySelector<HTMLElement>('.header-trigger__brand')!;
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect);
  row.getBoundingClientRect = () => rect(80, 20, 1120, 50);
  brand.getBoundingClientRect = () => rect(100, 20, 200, 50);
  panel.getBoundingClientRect = () => trigger.dataset.menuOpen === 'true' ? rect(80, 10, 400, 600) : rect(80, 10, 320, 190);
  row.querySelector<HTMLElement>('.header-trigger--end .header-trigger__panel')!.getBoundingClientRect = () => rect(1000, 10, 1120, 190);
  const matches = trigger.matches.bind(trigger);
  trigger.matches = selector => selector === ':hover' ? hovered : matches(selector);
  const template = doc.createElement('template');
  template.innerHTML = '<div data-header-menu-demo-scene><div data-header-menu-demo-veil hidden><svg><g data-header-menu-demo-position><circle data-header-menu-demo-iris r="100"></circle></g></svg></div><div data-header-menu-demo-cursor-layer><span data-header-menu-demo-cursor></span><div data-header-menu-demo-finger></div></div></div>';
  const previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  Object.assign(globalThis, { window: win, document: doc, Node: win.Node });
  const oldAnimate = win.Element.prototype.animate;
  win.Element.prototype.animate = function(frames: Keyframe[], options: KeyframeAnimationOptions) {
    const duration = Number(options.duration);
    expect(Number.isFinite(duration) && duration > 0).toBe(true);
    const trace: Trace = { node: this, frames, duration, easing: String(options.easing), start: now, startTime: now, cancelled: false };
    traces.push(trace);
    let reject!: (error: Error) => void;
    let timer: number;
    const finished = new Promise<void>((resolve, fail) => { reject = fail; timer = schedule(resolve, duration); });
    return {
      ready: Promise.resolve(), finished,
      get startTime() { return trace.startTime; },
      set startTime(value: number | null) { trace.startTime = value; },
      pause() { jobs.delete(timer); },
      cancel() { trace.cancelled = true; jobs.delete(timer); reject(new Error('cancelled')); },
    } as Animation;
  };
  const oldRect = win.HTMLElement.prototype.getBoundingClientRect;
  const at = (transform: unknown) => {
    const match = String(transform).match(/translate\(([-.\d]+)px, ([-.\d]+)px\)/)!;
    return { x: Number(match[1]), y: Number(match[2]) };
  };
  win.HTMLElement.prototype.getBoundingClientRect = function() {
    if (!this.matches('[data-header-menu-demo-cursor], [data-header-menu-demo-finger]')) return oldRect.call(this);
    const movement = traces.findLast(trace => trace.node === this && !trace.cancelled && trace.frames[0].transform);
    let p = at(this.style.transform);
    if (movement) {
      const progress = Math.max(0, Math.min(1, (now - Number(movement.startTime)) / movement.duration));
      const segment = progress * (movement.frames.length - 1);
      const i = Math.min(movement.frames.length - 2, Math.floor(segment));
      const a = at(movement.frames[i].transform), b = at(movement.frames[i + 1].transform), t = segment - i;
      p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    return rect(p.x, p.y, p.x + 24, p.y + 24);
  };
  doc.elementFromPoint = (x, y) => {
    const contains = (element: HTMLElement) => { const r = element.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; };
    const hit = hitOverride ?? (contains(brand) ? brand : contains(panel) ? panel : contains(row) ? row : x >= 340 && y > 100 ? doc.querySelector('.gallery-link')! : doc.body);
    const cursor = win.getComputedStyle(hit).cursor;
    const expected = ['pointer', 'grab', 'grabbing'].includes(cursor) ? cursor : 'arrow';
    const pointer = doc.querySelector<HTMLElement>('[data-header-menu-demo-cursor]');
    if (pointer) void Promise.resolve().then(() => samples.push({ expected, actual: pointer.dataset.cursorState }));
    return hit;
  };
  const demo = createHeaderMenuDemo({
    trigger, template, isEditing: () => editing,
    open() { trigger.dataset.menuOpen = 'true'; menu.push({ open: true, time: now }); },
    close() { delete trigger.dataset.menuOpen; menu.push({ open: false, time: now }); },
  });
  const advance = async (duration: number) => {
    const until = now + duration;
    await settle();
    for (let guard = 0; guard < 20000; guard++) {
      const next = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      jobs.delete(next[0]); now = next[1].at; next[1].fn(); await settle();
    }
    now = until;
    await settle();
  };
  const dismiss = (phase: 'dismissing' | 'dismissed') => {
    const surface = doc.querySelector<HTMLElement>('[data-home-intro-surface]')!;
    surface.dataset.state = phase; surface.hidden = phase === 'dismissed';
    win.dispatchEvent(new win.Event('vcd:home-intro-' + phase));
  };
  restores.push(() => {
    demo.cancel();
    win.Element.prototype.animate = oldAnimate;
    win.HTMLElement.prototype.getBoundingClientRect = oldRect;
    Object.assign(globalThis, previous);
  });
  return { win, doc, demo, trigger, panel, brand, traces, menu, samples, advance, dismiss, at, media, reduce,
    hit(element: Element) { hitOverride = element; },
    edit(value: boolean) { editing = value; },
    hover(value: boolean) { hovered = value; },
    get now() { return now; },
  };
}
const entry = (h: ReturnType<typeof fixture>, selector: string, duration?: number) =>
  h.traces.find(trace => trace.node.matches(selector) && (duration === undefined || trace.duration === duration))!;

test('waits for real intro interaction, anchors to exit start, and runs once per session', async () => {
  const h = fixture(); h.demo.start(); h.demo.start();
  await h.advance(5000);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).toBeNull();
  h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(800);
  expect(entry(h, '[data-header-menu-demo-iris]').start).toBe(5950);
  expect(h.win.sessionStorage.getItem('vcd:header-menu-demo-seen')).toBe('true');
  await h.advance(5000);
  const count = h.traces.length;
  h.demo.start(); h.dismiss('dismissing'); h.dismiss('dismissed'); await h.advance(6000);
  expect(h.traces).toHaveLength(count);
});

test('dismissed fallback supports entering Home after a direct project visit', async () => {
  const h = fixture({ intro: false, gallery: false }); h.demo.start();
  h.win.dispatchEvent(new h.win.Event('vcd:home-intro-dismissed')); await h.advance(2000);
  expect(h.traces).toHaveLength(0);
  h.doc.body.insertAdjacentHTML('beforeend', '<div data-home-intro-surface></div><div class="project-grid"></div>');
  h.dismiss('dismissed'); await h.advance(800);
  expect(entry(h, '[data-header-menu-demo-iris]').start).toBe(2800);
});

test('intro events outside Home and an already seen session do not arm', async () => {
  const h = fixture({ gallery: false }); h.demo.start(); h.dismiss('dismissing'); h.dismiss('dismissed'); await h.advance(6000);
  expect(h.traces).toHaveLength(0);
  const seen = fixture(); seen.win.sessionStorage.setItem('vcd:header-menu-demo-seen', 'true'); seen.demo.start(); seen.dismiss('dismissing'); await seen.advance(6000);
  expect(seen.traces).toHaveLength(0);
});

test('desktop timings match the approved settings and fade overlaps departure', async () => {
  const h = fixture(); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(4200);
  const iris = entry(h, '[data-header-menu-demo-iris]');
  const veil = entry(h, '[data-header-menu-demo-veil]');
  const fadeIn = entry(h, '[data-header-menu-demo-cursor]', 500);
  const moves = h.traces.filter(trace => trace.node.matches('[data-header-menu-demo-cursor]') && trace.frames.length === 61);
  const fadeOut = entry(h, '[data-header-menu-demo-cursor-layer]');
  expect([iris.start, iris.duration, iris.easing]).toEqual([950, 800, 'cubic-bezier(.23,1,.32,1)']);
  expect([veil.start, veil.duration, veil.easing]).toEqual([2375, 500, 'cubic-bezier(.23,1,.32,1)']);
  expect([fadeIn.start, fadeIn.duration]).toEqual([1825, 500]);
  expect(moves.map(trace => [trace.start, trace.duration])).toEqual([[2575, 500], [4075, 450]]);
  expect([fadeOut.start, fadeOut.duration, fadeOut.easing]).toEqual([4250, 100, 'cubic-bezier(.23,1,.32,1)']);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).not.toBeNull();
  expect(h.at(moves[0].frames[0].transform)).toEqual({ x: 368, y: 238 });
  expect(h.at(moves[1].frames.at(-1)!.transform)).toEqual({ x: 700, y: 35 });
  expect(h.menu.filter(event => event.open)).toHaveLength(1);
  expect(h.menu.find(event => !event.open)!.time).toBeLessThan(4525);
  await h.advance(175 + config.dismissDuration);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).toBeNull();
});

test('cursor and cutout share keyframes and start times; travel has smooth asymmetric endpoints', async () => {
  const h = fixture(); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(4500);
  const moves = h.traces.filter(trace => trace.node.matches('[data-header-menu-demo-cursor]') && trace.frames.length === 61);
  for (const move of moves) {
    const focus = h.traces.find(trace => trace.node.matches('[data-header-menu-demo-position]') && trace.start === move.start)!;
    expect(focus.frames).toEqual(move.frames); expect(focus.startTime).toBe(move.startTime); expect(focus.duration).toBe(move.duration);
    expect(move.easing).toBe('linear');
    const p = move.frames.map(frame => h.at(frame.transform));
    const steps = p.slice(1).map((point, i) => Math.hypot(point.x - p[i].x, point.y - p[i].y));
    expect(steps[0]).toBeLessThan(Math.max(...steps) * .06);
    expect(steps.at(-1)!).toBeLessThan(Math.max(...steps) * .06);
    expect(steps[0]).toBeGreaterThan(steps.at(-1)! * 1.8);
  }
});

test('the rendered hotspot drives CSS glyphs, including a non-clickable Home wordmark and occlusion', async () => {
  const h = fixture(); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(3050);
  const pointer = h.doc.querySelector<HTMLElement>('[data-header-menu-demo-cursor]')!;
  expect(pointer.dataset.cursorState).toBe('arrow');
  h.brand.style.cursor = 'pointer'; await h.advance(32); expect(pointer.dataset.cursorState).toBe('pointer');
  h.hit(h.doc.querySelector('.occluder')!); await h.advance(32); expect(pointer.dataset.cursorState).toBe('grab');
  expect(h.samples.length).toBeGreaterThan(20);
  expect(h.samples.every(sample => sample.expected === sample.actual)).toBe(true);
});

test('mobile keeps tap/release cleanup alive after the cursor has faded out', async () => {
  const h = fixture({ mobile: true }); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(4400);
  const fadeOut = entry(h, '[data-header-menu-demo-cursor-layer]');
  const moves = h.traces.filter(trace => trace.node.matches('[data-header-menu-demo-finger]') && trace.frames.length === 61);
  expect(moves.map(trace => [trace.start, trace.duration])).toEqual([[2315, 600], [4155, 450]]);
  expect(h.at(moves[0].frames[0].transform)).toEqual({ x: 600, y: 400 });
  expect(h.at(moves[1].frames.at(-1)!.transform)).toEqual({ x: 448, y: 648 });
  expect([fadeOut.start, fadeOut.duration]).toEqual([4450, 100]);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).not.toBeNull();
  await h.advance(175); expect(h.menu.at(-1)).toEqual({ open: false, time: 4725 });
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).not.toBeNull();
  await h.advance(120 + config.dismissDuration); expect(h.doc.querySelector('[data-header-menu-demo-scene]')).toBeNull();
});

test('reduced motion retains opacity durations and cannot resurrect the final outer fade', async () => {
  const h = fixture({ reduced: true }); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(3550);
  expect(h.traces.every(trace => trace.frames.every(frame => frame.transform === undefined))).toBe(true);
  const veilIn = entry(h, '[data-header-menu-demo-veil]', 800);
  const fadeOut = entry(h, '[data-header-menu-demo-cursor-layer]');
  expect(veilIn.start).toBe(950);
  expect([fadeOut.start, fadeOut.duration]).toEqual([3580, 100]);
  expect(h.doc.querySelector('[data-header-menu-demo-iris]')!.getAttribute('style')).toContain('scale(1)');
  await h.advance(155);
  const reappearance = h.traces.findLast(trace => trace.node.matches('[data-header-menu-demo-cursor]') && trace.frames[0].opacity === 0)!;
  expect(reappearance.start + reappearance.duration).toBe(3855);
  expect(fadeOut.node.contains(reappearance.node)).toBe(true);
  await h.advance(config.dismissDuration);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).toBeNull();
});

test('fonts and initial reveal waits cancel without later resurrection', async () => {
  const h = fixture();
  let resolveFonts!: () => void;
  Object.defineProperty(h.doc, 'fonts', { value: { ready: new Promise<void>(resolve => { resolveFonts = resolve; }) } });
  h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed');
  h.win.dispatchEvent(new h.win.Event('click', { bubbles: true })); resolveFonts(); await h.advance(6000);
  expect(h.traces).toHaveLength(0); expect(h.win.sessionStorage.getItem('vcd:header-menu-demo-seen')).toBeNull();
  const reveal = fixture({ reveal: true }); reveal.demo.start(); reveal.dismiss('dismissing'); await reveal.advance(150); reveal.dismiss('dismissed');
  reveal.win.dispatchEvent(new reveal.win.Event('resize')); reveal.win.dispatchEvent(new reveal.win.Event('vcd:initial-reveal-complete')); await reveal.advance(6000);
  expect(reveal.traces).toHaveLength(0);
});

test('intro interaction and passive events do not cancel pending readiness', async () => {
  const h = fixture();
  let resolveFonts!: () => void;
  Object.defineProperty(h.doc, 'fonts', { value: { ready: new Promise<void>(resolve => { resolveFonts = resolve; }) } });
  h.demo.start(); h.dismiss('dismissing');
  for (const type of ['click', 'pointermove', 'wheel', 'scroll', 'keydown']) h.win.dispatchEvent(new h.win.Event(type, { bubbles: true }));
  await h.advance(150); h.dismiss('dismissed'); resolveFonts(); await h.advance(800);
  expect(entry(h, '[data-header-menu-demo-iris]').start).toBe(950);
});

test('late font readiness shifts the sequence together instead of compressing its timings', async () => {
  const h = fixture();
  let resolveFonts!: () => void;
  Object.defineProperty(h.doc, 'fonts', { value: { ready: new Promise<void>(resolve => { resolveFonts = resolve; }) } });
  h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(2000);
  resolveFonts(); await h.advance(1200);
  const iris = entry(h, '[data-header-menu-demo-iris]');
  const cursor = entry(h, '[data-header-menu-demo-cursor]', 500);
  expect(iris.start).toBe(2182);
  expect(cursor.start - iris.start).toBe(875);
});

test('navigation title readiness is checked at the visual cue rather than during intro exit', async () => {
  const h = fixture(); h.trigger.dataset.headerTitlePending = '';
  h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(350);
  delete h.trigger.dataset.headerTitlePending;
  await h.advance(450);
  expect(entry(h, '[data-header-menu-demo-iris]').start).toBe(950);
});

test('cancellation during animation removes the scene and all later menu work', async () => {
  const h = fixture(); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(1000);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).not.toBeNull();
  h.demo.cancel(); await h.advance(6000);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).toBeNull();
  expect(h.menu).toHaveLength(0);
  expect(h.traces.every(trace => trace.cancelled || trace.duration === config.dismissDuration)).toBe(true);
});

test('a real click inside the menu preserves it while cancelling the guide', async () => {
  const h = fixture(); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(3050);
  expect(h.trigger.dataset.menuOpen).toBe('true');
  h.brand.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true })); await h.advance(6000);
  expect(h.trigger.dataset.menuOpen).toBe('true');
  expect(h.menu.filter(event => !event.open)).toHaveLength(0);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).toBeNull();
});

test('a real hover on the trigger cancels the guide and leaves the menu open', async () => {
  const h = fixture(); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(2700);
  const traces = h.traces.length;
  h.hover(true); h.trigger.dispatchEvent(new h.win.MouseEvent('mouseenter')); h.hover(false); await h.advance(6000);
  expect(h.traces.slice(traces).every(trace => trace.duration === config.dismissDuration)).toBe(true);
  expect(h.menu.filter(event => !event.open)).toHaveLength(0);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).toBeNull();
});

test('a page scroll cancels the guide and closes its menu, but the intro reset to the top does not', async () => {
  const h = fixture(); h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed');
  h.win.dispatchEvent(new h.win.Event('scroll')); await h.advance(3050);
  expect(h.trigger.dataset.menuOpen).toBe('true');
  Object.defineProperty(h.win, 'scrollY', { value: 120, configurable: true });
  h.win.dispatchEvent(new h.win.Event('scroll')); await h.advance(16);
  expect(h.trigger.dataset.menuOpen).toBeUndefined();
  const fades = h.traces.filter(trace => trace.duration === config.dismissDuration);
  expect(fades.map(trace => trace.frames.at(-1)!.opacity)).toEqual([0, 0]);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).not.toBeNull();
  await h.advance(config.dismissDuration);
  expect(h.doc.querySelector('[data-header-menu-demo-scene]')).toBeNull();
  await h.advance(6000);
  expect(h.menu).toEqual([{ open: true, time: expect.any(Number) }, { open: false, time: 3200 }]);
});

test('editing, visibility, hover, focus, pending title, and an already open menu prevent the hint', async () => {
  for (const guard of ['edit', 'hidden', 'hover', 'focus', 'title', 'menu']) {
    const h = fixture();
    if (guard === 'edit') h.edit(true);
    if (guard === 'hidden') Object.defineProperty(h.doc, 'hidden', { value: true });
    if (guard === 'hover') h.hover(true);
    if (guard === 'focus') h.brand.focus();
    if (guard === 'title') h.trigger.dataset.headerTitlePending = '';
    if (guard === 'menu') h.trigger.dataset.menuOpen = 'true';
    h.demo.start(); h.dismiss('dismissing'); await h.advance(150); h.dismiss('dismissed'); await h.advance(6000);
    expect(h.traces).toHaveLength(0);
    expect(h.win.sessionStorage.getItem('vcd:header-menu-demo-seen')).toBeNull();
  }
});
