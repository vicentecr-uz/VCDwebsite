import { afterEach, expect, test } from 'bun:test';
import { Window, BrowserErrorCaptureEnum } from 'happy-dom';
import { readFileSync } from 'node:fs';
import * as geometry from '../../src/lib/imageLightbox';
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

const script = readFileSync(new URL('../../src/components/ImageLightbox.astro', import.meta.url), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)![1];
const source = script.slice(0, script.indexOf('  import { onPageLoad }'))
  .replace(/import\s+\{[\s\S]*?\}\s+from\s+'\.\.\/lib\/imageLightbox';/, '')
  .replace(/import\s+\{\s*gsap\s*\}\s+from\s+'gsap';/, '')
  .replace(/import\s+\{\s*CustomEase\s*\}\s+from\s+'gsap\/CustomEase';/, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

function fixture(reducedMotion = false, options: { loaded?: boolean; preview?: string; session?: Storage; coarse?: boolean; width?: number; imageHeight?: number; random?: () => number } = {}) {
  const window = new Window({ url: 'http://localhost:4323', settings: { errorCapture: BrowserErrorCaptureEnum.disabled } });
  const document = window.document;
  document.body.innerHTML = `<img id="source" alt="Study" data-image-original="/images/study.jpg" role="button" tabindex="0">
    <dialog data-image-lightbox><div data-image-lightbox-viewer tabindex="0"><img data-image-lightbox-image><span data-image-lightbox-demo-pointer="one" aria-hidden="true"></span><span data-image-lightbox-demo-pointer="two" aria-hidden="true"></span><p data-image-lightbox-error hidden></p><label><select data-image-lightbox-input-mode aria-label="Input mode"><option value="auto">Auto</option><option value="mouse">Mouse</option><option value="trackpad">Trackpad</option></select></label></div>
    </dialog>`;
  const original = document.querySelector<HTMLImageElement>('#source')!;
  const dialog = document.querySelector('dialog')!;
  const viewer = dialog.querySelector<HTMLElement>('[data-image-lightbox-viewer]')!;
  const image = dialog.querySelector<HTMLImageElement>('[data-image-lightbox-image]')!;
  if (options.preview) { original.src = options.preview; original.dataset.imageOriginal = '/images/study.jpg'; }
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, FrameRequestCallback>();
  window.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => timers.delete(id)) as typeof window.clearTimeout;
  const raf = (callback: FrameRequestCallback) => { const id = ++nextId; frames.set(id, callback); return id; };
  const captured = new Set<number>();
  viewer.setPointerCapture = (id: number) => { captured.add(id); };
  viewer.hasPointerCapture = (id: number) => captured.has(id);
  viewer.releasePointerCapture = (id: number) => { captured.delete(id); };
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  Object.defineProperties(viewer, { clientWidth: { value: options.width ?? 800 }, clientHeight: { value: 600 } });
  Object.defineProperties(image, { offsetWidth: { value: 800 }, offsetHeight: { value: options.imageHeight ?? 600 } });
  if (options.loaded) {
    Object.defineProperties(original, { complete: { value: true }, naturalWidth: { value: 1200 }, naturalHeight: { value: 800 }, currentSrc: { value: options.preview || '/images/study.jpg' } });
    Object.defineProperties(image, { complete: { value: true, configurable: true }, naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
  }
  viewer.getBoundingClientRect = () => ({ left: 100, top: 100, width: options.width ?? 800, height: 600 } as DOMRect);
  const env = { ...geometry, window, document, Element: window.Element, MutationObserver: window.MutationObserver,
    requestAnimationFrame: raf, cancelAnimationFrame: (id: number) => frames.delete(id),
    getComputedStyle: window.getComputedStyle.bind(window), localStorage: window.localStorage, sessionStorage: options.session || window.sessionStorage, performance: { now: () => now },
    matchMedia: (query: string) => ({ matches: query.includes('prefers-reduced-motion') ? reducedMotion : query.includes('pointer: coarse') ? Boolean(options.coarse) : false }), gsap, CustomEase, Math: Object.assign(Object.create(Math), { random: options.random ?? (() => .9) }) };
  const bind = new Function(...Object.keys(env), `${compiled}; return bindImageLightbox;`)(...Object.values(env));
  const dispose = bind(dialog);
  cleanups.push(dispose);
  const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(now)); };
  const tick = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  };
  const click = (target: Element = original, options = {}) => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
  const key = (key: string, target: EventTarget = viewer) => target.dispatchEvent(new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
  const wheel = (deltaY: number, ctrlKey = false, deltaMode = 0, x = 500, y = 400, deltaX = 0, target: EventTarget = viewer) => {
    const event = new window.WheelEvent('wheel', {deltaY, deltaMode, bubbles:true, cancelable:true});
    Object.assign(event, {ctrlKey, clientX:x, clientY:y, deltaX});
    return target.dispatchEvent(event);
  };
  const gesture = (type: string, scale = 1, rotation = 0) => {
    const event = new window.Event(type, {bubbles:true,cancelable:true});
    Object.assign(event, {scale, rotation, clientX:500, clientY:400});
    viewer.dispatchEvent(event);
    return event;
  };
  const settleSpring = () => { for (let i=0; i<180; i++) { tick(16); frame(); } };
  const pointer = (type: string, id: number, x = 400, y = 400, button = 0, altKey = false, target: EventTarget = viewer) => {
    const event = new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, clientX: x, clientY: y, button });
    Object.assign(event, { altKey });
    return target.dispatchEvent(event);
  };
  return { window, document, original, dialog, viewer, image, click, key, wheel, gesture, settleSpring, pointer, frame, tick, frames, timers, captured, dispose };
}

for (const key of ['Enter', ' ']) {
  test(`${key}: opens original only on activation, then fades before restoring focus`, () => {
    const f = fixture();
    expect(f.image.hasAttribute('src')).toBe(false);
    const event = new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    f.original.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(f.dialog.open).toBe(true);
    expect(f.image.getAttribute('src')).toBe('/images/study.jpg');
    expect(f.document.activeElement).toBe(f.viewer);
    expect(f.dialog.classList.contains('is-visible')).toBe(false);
    f.frame(); f.frame();
    expect(f.dialog.classList.contains('is-visible')).toBe(true);
    f.key('Escape');
    f.tick(149);
    expect(f.dialog.open).toBe(true);
    expect(f.image.hasAttribute('src')).toBe(true);
    f.tick(1);
    expect(f.dialog.open).toBe(false);
    expect(f.image.hasAttribute('src')).toBe(false);
    expect(f.document.activeElement).toBe(f.original);
  });
}

test('links, editable/hidden content, cancelled events and Edit mode do not open', () => {
  const f = fixture();
  for (const attrs of ['href="/other"', 'contenteditable="plaintext-only"', 'aria-hidden="true"', 'class="dev-crop-stage"']) {
    const parent = f.document.createElement(attrs.startsWith('href') ? 'a' : 'div');
    const parsed = f.document.createElement('div'); parsed.innerHTML = `<${parent.tagName.toLowerCase()} ${attrs}></${parent.tagName.toLowerCase()}>`;
    const wrapper = parsed.firstElementChild!;
    f.original.replaceWith(wrapper); wrapper.append(f.original);
    f.click(); expect(f.dialog.open).toBe(false);
    wrapper.replaceWith(f.original);
  }
  const cancelled = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  cancelled.preventDefault(); f.original.dispatchEvent(cancelled);
  expect(f.dialog.open).toBe(false);
  f.document.documentElement.classList.add('is-dev-mode');
  f.click(); expect(f.dialog.open).toBe(false);
  f.document.documentElement.classList.remove('is-dev-mode');
  f.click(); expect(f.dialog.open).toBe(true);
});

test('closing before entry paint and reopening cannot apply stale frames or source cleanup', () => {
  const f = fixture(); f.click(); f.key('Escape');
  f.frame(); f.frame();
  expect(f.dialog.classList.contains('is-visible')).toBe(false);
  f.original.dataset.imageOriginal = '/images/new.jpg';
  f.click(); f.tick(150); f.frame(); f.frame();
  expect(f.dialog.open).toBe(true);
  expect(f.image.getAttribute('src')).toBe('/images/new.jpg');
  expect(f.dialog.classList.contains('is-visible')).toBe(true);
});

test('pinch stays centred, clamps scale/pan, and release cannot dismiss', () => {
  const f = fixture(); f.click();
  f.pointer('pointerdown', 1, 400, 400); f.pointer('pointerdown', 2, 600, 400);
  f.pointer('pointermove', 1, 300, 400); f.pointer('pointermove', 2, 700, 400);
  expect(f.image.style.transform).toContain('scale(2)');
  f.pointer('pointerup', 2, 700, 400);
  f.pointer('pointermove', 1, 5000, 400);
  expect(f.image.style.transform).toContain('400px');
  expect(f.image.style.transform).toContain('scale(2)');
  f.pointer('pointerup', 1); f.click(f.viewer); f.tick(150);
  expect(f.dialog.open).toBe(true);
  expect(f.captured.size).toBe(0);
  f.key('0');
  for (let i = 0; i < 10; i++) f.key('+');
  expect(f.image.style.transform).toContain('scale(4)');
});

test('off-centre pinch keeps its focal translation on the first zoom step', () => {
  const f=fixture(); f.click();
  f.pointer('pointerdown',1,200,400); f.pointer('pointerdown',2,400,400);
  f.pointer('pointermove',1,190,400); f.pointer('pointermove',2,410,400);
  expect(f.image.style.transform).toContain('scale(1.1)');
  expect(Number(/translate\(([-\d.e+]+)px/.exec(f.image.style.transform)![1])).not.toBe(0);
});

test('cancelled pointer and two-finger tap do not dismiss; next plain tap can dismiss', () => {
  const f = fixture(); f.click();
  f.pointer('pointerdown', 1); f.pointer('pointerdown', 2);
  f.pointer('pointercancel', 1); f.pointer('pointerup', 2);
  f.click(f.viewer); f.tick(150); expect(f.dialog.open).toBe(true);
  f.pointer('pointerdown', 3); f.pointer('pointerup', 3);
  f.click(f.viewer); f.tick(150); expect(f.dialog.open).toBe(false);
});

test('keyboard users can zoom and pan; reset returns to fit', () => {
  const f = fixture(); f.click(); f.key('+');
  f.viewer.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(f.image.style.transform).toContain('-40px');
  expect(f.image.style.transform).toContain('scale(1.5)');
  f.key('0');
  expect(f.image.style.transform).toContain('scale(1)');
});

test('image errors keep dismissal usable; Escape, pagehide and disposal clean up', () => {
  const f = fixture(); f.click();
  f.image.dispatchEvent(new f.window.Event('error'));
  expect(f.dialog.querySelector<HTMLElement>('[data-image-lightbox-error]')!.hidden).toBe(false);
  f.dialog.dispatchEvent(new f.window.Event('cancel', { cancelable: true })); f.tick(150);
  expect(f.dialog.open).toBe(false);
  f.click(); f.window.dispatchEvent(new f.window.Event('pagehide'));
  expect(f.dialog.open).toBe(false); expect(f.timers.size).toBe(0); expect(f.frames.size).toBe(0);
  f.click(); f.dispose(); f.click(); f.frame(); f.tick(150);
  expect(f.dialog.open).toBe(false);
});

test('live source helper removes placeholder actions and uses the new original', () => {
  const f = fixture(); geometry.syncLightboxImage(f.original, '/images/placeholder.svg');
  expect(f.original.hasAttribute('tabindex')).toBe(false); f.click(); expect(f.dialog.open).toBe(false);
  geometry.syncLightboxImage(f.original, '/images/replacement.jpg');
  f.click(); expect(f.image.getAttribute('src')).toBe('/images/replacement.jpg');
  expect(geometry.clampImageScale(Infinity)).toBe(1);
});

test('opening carries the configured frame fill with the original image and clears it on reuse', () => {
  const f = fixture();
  f.original.src = '/images/study.thumb.webp';
  f.original.dataset.imagePreview = '/images/study.preview.webp';
  f.original.style.setProperty('--project-image-background', '#f5f5f7');
  f.click();
  expect(f.image.getAttribute('src')).toBe('/images/study.jpg');
  expect(['#f5f5f7', 'rgb(245, 245, 247)']).toContain(f.image.style.backgroundColor);
  f.key('Escape'); f.tick(150);
  f.original.style.removeProperty('--project-image-background');
  f.click();
  expect(['', 'transparent']).toContain(f.image.style.backgroundColor);
});

test('drag tracks, twists and fades; crossing and reversing the threshold keeps the veil and springs home', () => {
  const f=fixture(); f.click(); f.frame(); f.frame();
  f.pointer('pointerdown',1,400,400); f.pointer('pointermove',1,466,400);
  expect(f.image.style.transform).toContain('66px');
  expect(Number(f.image.style.opacity)).toBeCloseTo(.85,2);
  expect(f.image.style.filter).toBe('');
  f.pointer('pointermove',1,550,400);
  expect(Number(f.image.style.opacity)).toBeCloseTo(.1);
  expect(f.dialog.classList.contains('is-visible')).toBe(true);
  f.pointer('pointermove',1,430,400);
  expect(Number(f.image.style.opacity)).toBeGreaterThan(.7);
  f.pointer('pointerup',1,430,400); f.settleSpring();
  expect(f.dialog.open).toBe(true);
  expect(Number(f.image.style.opacity)).toBe(1);
  expect(f.image.style.transform).toContain('translate(0px, 0px)');
});

test('release past the drag threshold closes in 150ms; cancelled or lost capture gestures never close', () => {
  for (const type of ['pointercancel','lostpointercapture','pointerup']) {
    const f=fixture(); f.click(); f.frame(); f.frame();
    f.pointer('pointerdown',1,400,400); f.pointer('pointermove',1,600,400);
    f.pointer(type,1,600,400);
    if(type==='pointerup') {
      f.tick(149); expect(f.dialog.open).toBe(true); f.tick(1); expect(f.dialog.open).toBe(false);
    } else {f.settleSpring(); expect(f.dialog.open).toBe(true);}
  }
});

test('a second finger cancels single-drag dismissal and a new touch can interrupt spring-back', () => {
  const f=fixture(); f.click();
  f.pointer('pointerdown',1,400,400); f.pointer('pointermove',1,550,400);
  f.pointer('pointerdown',2,700,400); f.pointer('pointerup',2,700,400); f.pointer('pointerup',1,550,400);
  f.settleSpring(); expect(f.dialog.open).toBe(true);
  f.pointer('pointerdown',3,400,400); f.pointer('pointermove',3,450,400); f.pointer('pointerup',3,450,400);
  f.tick(16); f.frame();
  const position=f.image.style.transform;
  f.pointer('pointerdown',4,450,400);
  expect(f.image.style.transform).toBe(position);
  f.pointer('pointercancel',4); f.settleSpring(); expect(f.dialog.open).toBe(true);
});

test('pinching inward from fit can arm dismissal, reverse, or close only on release', () => {
  for(const reverse of [true,false]) {
    const f=fixture(); f.click();
    f.pointer('pointerdown',1,400,400); f.pointer('pointerdown',2,600,400);
    f.pointer('pointermove',1,430,400); f.pointer('pointermove',2,570,400);
    expect(Number(f.image.style.opacity)).toBe(.1);
    expect(f.image.style.filter).toBe('');
    expect(f.dialog.open).toBe(true);
    if(reverse) {f.pointer('pointermove',1,410,400); f.pointer('pointermove',2,590,400); expect(Number(f.image.style.opacity)).toBeGreaterThan(.7);}
    f.pointer('pointerup',2,reverse?590:570,400); f.pointer('pointerup',1,reverse?410:430,400);
    f.settleSpring(); expect(f.dialog.open).toBe(reverse);
  }
});

test('a pinch beginning zoomed in returns to fit without accidentally dismissing', () => {
  const f=fixture(); f.click(); f.key('+'); f.key('+');
  f.pointer('pointerdown',1,300,400); f.pointer('pointerdown',2,700,400);
  f.pointer('pointermove',1,490,400); f.pointer('pointermove',2,510,400);
  expect(f.image.style.transform).toContain('scale(1)');
  f.pointer('pointerup',1); f.pointer('pointerup',2); f.settleSpring();
  expect(f.dialog.open).toBe(true);
});

test('mouse wheel zooms at the cursor and never dismisses at minimum scale', () => {
  const f=fixture(); f.click(); f.wheel(-1000);
  expect(f.image.style.transform).not.toContain('scale(1)');
  for(let i=0;i<12;i++)f.wheel(1000);
  f.tick(200); expect(f.dialog.open).toBe(true);
  expect(f.image.style.transform).toContain('scale(1)');
});

test('wheel zoom keeps an off-centre pointer anchored', () => {
  const f=fixture(); f.click(); f.wheel(-100, true, 0, 250, 300);
  expect(Number(/translate\(([-\d.e+]+)px/.exec(f.image.style.transform)![1])).toBeGreaterThan(0);
  expect(Number(/translate\([^,]+px, ([-\d.e+]+)px/.exec(f.image.style.transform)![1])).toBeGreaterThan(0);
});

test('Alt-drag rotates on desktop and springs back upright', () => {
  const f=fixture(); f.click();
  f.pointer('pointerdown',1,400,400,0,true); f.pointer('pointermove',1,440,400,0,true);
  expect(rotationOf(f.image)).toBeGreaterThan(0);
  f.pointer('pointerup',1,440,400,0,true); f.settleSpring();
  expect(rotationOf(f.image)).toBe(0);
  expect(f.dialog.open).toBe(true);
});

test('input mode override persists and trackpad wheel pans without dismissing', () => {
  const f=fixture();
  const select = f.viewer.querySelector<HTMLSelectElement>('[data-image-lightbox-input-mode]')!;
  select.value = 'trackpad'; select.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  f.click(); f.key('+'); f.wheel(30, false, 0, 500, 400, 20);
  expect(f.image.style.transform).toContain('translate(-20px, -30px)');
  f.tick(200); expect(f.dialog.open).toBe(true);
  expect(f.window.localStorage.getItem('vcd:image-lightbox-input-mode')).toBe('trackpad');
});

test('input mode select keeps native pointer, keyboard and wheel interaction', () => {
  const f=fixture(); f.click();
  const select = f.viewer.querySelector<HTMLSelectElement>('[data-image-lightbox-input-mode]')!;
  const pointerEvent = new f.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 7, clientX: 500, clientY: 400, button: 0 });
  select.dispatchEvent(pointerEvent);
  expect(pointerEvent.defaultPrevented).toBe(false);
  expect(f.captured.size).toBe(0);
  const keyEvent = new f.window.KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
  select.dispatchEvent(keyEvent);
  expect(keyEvent.defaultPrevented).toBe(false);
  expect(f.image.style.transform).toContain('scale(1)');
  const wheelEvent = new f.window.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
  select.dispatchEvent(wheelEvent);
  expect(wheelEvent.defaultPrevented).toBe(false);
  expect(f.image.style.transform).toContain('scale(1)');
});

for (const targetName of ['viewer', 'image', 'dialog'] as const) {
  test(`click-away on ${targetName} closes the popup without dismissing the lightbox`, () => {
  const f = fixture(); f.click();
  const listbox = f.document.createElement('ul');
  listbox.className = 'dev-select__listbox is-closing';
  f.viewer.append(listbox);
  let popupOpen = true;
  const nativeMatches = listbox.matches.bind(listbox);
  listbox.matches = (selector: string) => selector === ':popover-open' ? popupOpen : nativeMatches(selector);

  // The shared SelectField capture handler closes the popup while its fade is
  // still running; the lightbox must remember that state for this click.
  f.pointer('pointerdown', 1, 500, 400, 0, false, f[targetName]);
  expect(f.viewer.classList.contains('is-dragging')).toBe(false);
  popupOpen = false;
  listbox.classList.remove('is-closing');
  f.tick(250);
  f.click(f[targetName]);
  expect(f.dialog.open).toBe(true);

  // A later click, after the popup sequence has been consumed, dismisses.
  f.click(f.dialog); f.tick(150);
  expect(f.dialog.open).toBe(false);
  });
}

test('backdrop click without an open popup still dismisses the lightbox', () => {
  const f = fixture(); f.click();
  f.pointer('pointerdown', 1, 500, 400, 0, false, f.dialog);
  f.click(f.dialog); f.tick(150);
  expect(f.dialog.open).toBe(false);
});

test('trackpad swipe from fit dismisses only after the idle boundary', () => {
  const f=fixture(); const select = f.viewer.querySelector<HTMLSelectElement>('[data-image-lightbox-input-mode]')!;
  select.value = 'trackpad'; select.dispatchEvent(new f.window.Event('change', { bubbles: true })); f.click();
  f.wheel(100); f.wheel(100);
  expect(Number(f.image.style.opacity)).toBe(.1);
  expect(f.dialog.open).toBe(true);
  f.tick(159); expect(f.dialog.open).toBe(true);
  f.tick(1); expect(f.dialog.open).toBe(true);
  f.tick(149); expect(f.dialog.open).toBe(true);
  f.tick(1); expect(f.dialog.open).toBe(false);
});

test('trackpad swipe below threshold springs home at idle', () => {
  const f=fixture(); const select = f.viewer.querySelector<HTMLSelectElement>('[data-image-lightbox-input-mode]')!;
  select.value = 'trackpad'; select.dispatchEvent(new f.window.Event('change', { bubbles: true })); f.click();
  f.wheel(40); f.tick(160); f.settleSpring();
  expect(f.dialog.open).toBe(true);
  expect(f.image.style.transform).toContain('translate(0px, 0px)');
});

test('trackpad swipe reverses before idle and does not dismiss', () => {
  const f=fixture(); const select = f.viewer.querySelector<HTMLSelectElement>('[data-image-lightbox-input-mode]')!;
  select.value = 'trackpad'; select.dispatchEvent(new f.window.Event('change', { bubbles: true })); f.click();
  f.wheel(100); f.wheel(-80);
  expect(Number(f.image.style.opacity)).toBeGreaterThan(.7);
  f.tick(160); f.settleSpring(); expect(f.dialog.open).toBe(true);
});

test('trackpad pan started zoomed cannot dismiss after returning to fit in one burst', () => {
  const f=fixture(); const select = f.viewer.querySelector<HTMLSelectElement>('[data-image-lightbox-input-mode]')!;
  select.value = 'trackpad'; select.dispatchEvent(new f.window.Event('change', { bubbles: true })); f.click(); f.key('+');
  f.wheel(100, true); f.wheel(100); f.tick(160); f.settleSpring();
  expect(f.dialog.open).toBe(true);
});

test('zoomed trackpad pan never dismisses', () => {
  const f=fixture(); const select = f.viewer.querySelector<HTMLSelectElement>('[data-image-lightbox-input-mode]')!;
  select.value = 'trackpad'; select.dispatchEvent(new f.window.Event('change', { bubbles: true })); f.click(); f.key('+');
  f.wheel(300); f.tick(160); f.settleSpring();
  expect(f.dialog.open).toBe(true);
});

test('auto wheel mode stays locked for one burst and resets after inactivity', () => {
  const f=fixture(); f.click(); f.wheel(-100, false); const first = f.image.style.transform;
  f.wheel(2, false, 0, 500, 400, 1);
  expect(f.image.style.transform).not.toBe(first);
  f.tick(200); f.wheel(2, false, 0, 500, 400, 1);
  expect(f.image.style.transform).toContain('translate(-1px, -2px)');
});

test('auto mode retains trackpad confidence for a fast vertical burst', () => {
  const f=fixture(); f.click(); f.gesture('gesturestart'); f.gesture('gestureend'); f.tick(300);
  f.key('+'); f.wheel(100);
  expect(f.image.style.transform).toContain('translate(0px, -100px)');
  expect(f.image.style.transform).toContain('scale(1.5)');
});

test('auto mode promotes repeated coarse bursts to mouse at the next burst', () => {
  const f=fixture(); f.click(); f.key('+'); f.wheel(2); f.tick(200);
  f.wheel(100); f.wheel(100); f.wheel(100); f.tick(200);
  f.wheel(100); f.wheel(100); f.wheel(100); f.tick(200);
  const before = f.image.style.transform;
  f.wheel(-100);
  expect(f.image.style.transform).not.toBe(before);
  expect(Number(/scale\(([^)]+)\)/.exec(f.image.style.transform)![1])).toBeGreaterThan(1.8);
});

test('trackpad pinch wheel ends after inactivity and supports underzoom dismissal', () => {
  const f=fixture(); f.click();
  for(let i=0;i<8;i++)f.wheel(200,true);
  expect(Number(f.image.style.opacity)).toBe(.1);
  expect(f.dialog.open).toBe(true);
  f.tick(160); f.tick(150); expect(f.dialog.open).toBe(false);
});

test('Safari rotation has a dead zone, pinch zoom works, and duplicate wheel is ignored', () => {
  const f=fixture(); f.click(); f.gesture('gesturestart');
  f.gesture('gesturechange',1.5,6);
  expect(f.image.style.transform).toContain('scale(1.5)');
  const before=f.image.style.transform; f.wheel(500,true); expect(f.image.style.transform).toBe(before);
  f.gesture('gesturechange',1.5,30); f.tick(16); f.frame(); expect(f.image.style.transform).not.toBe(before);
  f.gesture('gestureend',1.5,30); f.tick(200); expect(f.dialog.open).toBe(true);
});

test('reduced motion preserves drag feedback and settles without leaving animation work', () => {
  const f=fixture(true); f.click(); f.frame(); f.frame();
  f.pointer('pointerdown',1,400,400); f.pointer('pointermove',1,440,400);
  expect(Number(f.image.style.opacity)).toBeLessThan(1);
  f.pointer('pointerup',1,440,400); f.settleSpring();
  expect(f.dialog.open).toBe(true); expect(f.frames.size).toBe(0);
});

test('release coordinates disarm a drag even if the final move was coalesced', () => {
  const f=fixture(); f.click();
  f.pointer('pointerdown',1,400,400); f.pointer('pointermove',1,600,400);
  f.pointer('pointerup',1,430,400); f.settleSpring();
  expect(f.dialog.open).toBe(true);
});

test('trackpad underzoom can reverse before the idle boundary and navigation clears pending work', () => {
  const f=fixture(); f.click();
  f.wheel(200,true); f.wheel(200,true);
  expect(Number(f.image.style.opacity)).toBe(.1);
  f.wheel(-80,true);
  expect(Number(f.image.style.opacity)).toBeGreaterThan(.7);
  f.tick(160); f.settleSpring(); expect(f.dialog.open).toBe(true);
  f.wheel(200,true); f.window.dispatchEvent(new f.window.Event('pagehide'));
  expect(f.timers.size).toBe(0); expect(f.frames.size).toBe(0);
});

test('Safari inward pinch can reverse and return to fit without closing', () => {
  const f=fixture(); f.click(); f.gesture('gesturestart');
  f.gesture('gesturechange',.7); expect(Number(f.image.style.opacity)).toBe(.1);
  f.gesture('gesturechange',.95); expect(Number(f.image.style.opacity)).toBeGreaterThan(.7);
  f.gesture('gestureend',.95); f.settleSpring(); expect(f.dialog.open).toBe(true);
});

const rotationOf = (image: HTMLImageElement) => Number(/rotate\(([-\d.e+]+)deg\)/.exec(image.style.transform)![1]);

test('small twists have resisted give and spring upright on release without changing zoom', () => {
  for (const degrees of [-20,-5,5,20,350,370]) {
    const f=fixture(); f.click(); f.gesture('gesturestart');
    f.gesture('gesturechange',2,degrees);
    const upright=Math.round(degrees/360)*360;
    expect(rotationOf(f.image)).toBeCloseTo(upright+(degrees-upright)*.1);
    const before=rotationOf(f.image);
    f.gesture('gestureend',2,degrees);
    expect(rotationOf(f.image)).toBe(before);
    f.tick(16); f.frame();
    expect(Math.abs(rotationOf(f.image)-upright)).toBeLessThan(Math.abs(before-upright));
    f.settleSpring();
    expect(rotationOf(f.image)).toBeCloseTo(upright);
    expect(f.image.style.transform).toContain('scale(2)');
  }
});

test('crossing twenty degrees releases resistance smoothly and reversing re-engages it without jumping', () => {
  const f=fixture(); f.click(); f.gesture('gesturestart');
  f.gesture('gesturechange',2,20); expect(rotationOf(f.image)).toBe(2);
  f.gesture('gesturechange',2,21); expect(rotationOf(f.image)).toBe(2);
  f.tick(16); f.frame();
  expect(rotationOf(f.image)).toBeGreaterThan(2); expect(rotationOf(f.image)).toBeLessThan(21);
  f.settleSpring(); expect(rotationOf(f.image)).toBe(21);
  f.gesture('gesturechange',2,19); expect(rotationOf(f.image)).toBe(21);
  f.settleSpring(); expect(rotationOf(f.image)).toBeCloseTo(1.9);
  f.gesture('gestureend',2,19); f.settleSpring(); expect(rotationOf(f.image)).toBe(0);
});

test('touch rotation gives slightly and springs upright when fingers release inside the resistance zone', () => {
  const f=fixture(); f.click();
  f.pointer('pointerdown',1,400,400); f.pointer('pointerdown',2,600,400);
  f.pointer('pointermove',2,600,420);
  expect(rotationOf(f.image)).toBeGreaterThan(0); expect(rotationOf(f.image)).toBeLessThan(2);
  const before=rotationOf(f.image);
  f.pointer('pointerup',2,600,420); f.pointer('pointerup',1,400,400);
  expect(rotationOf(f.image)).toBe(before);
  f.settleSpring(); expect(rotationOf(f.image)).toBe(0); expect(f.dialog.open).toBe(true);
});

test('deliberate rotation is retained outside the resistance zone and pending release animation cleans up', () => {
  const f=fixture(); f.click(); f.gesture('gesturestart');
  f.gesture('gesturechange',2,90); f.gesture('gestureend',2,90); f.settleSpring();
  expect(rotationOf(f.image)).toBe(90);
  f.gesture('gesturestart'); f.gesture('gesturechange',2,-80);
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
});

test('pointer dismissal clears the returned image focus, while keyboard dismissal preserves it', () => {
  const f=fixture(); f.click();
  f.pointer('pointerdown',1,400,400); f.pointer('pointerup',1,400,400);
  f.click(f.viewer); f.tick(150);
  expect(f.dialog.open).toBe(false);
  expect(f.document.activeElement).not.toBe(f.original);
  f.click(); f.key('Escape'); f.tick(150);
  expect(f.document.activeElement).toBe(f.original);
});

test('staggered finger release and remaining-finger movement cannot strand resisted rotation', () => {
  for (const drift of [.5,30]) {
    const f=fixture(); f.click(); f.key('+');
    f.pointer('pointerdown',1,400,400); f.pointer('pointerdown',2,600,400);
    f.pointer('pointermove',2,600,430);
    const scale=/scale\(([^)]+)\)/.exec(f.image.style.transform)![1];
    expect(rotationOf(f.image)).toBeGreaterThan(0);
    f.pointer('pointerup',2,600,430);
    f.tick(16); f.frame();
    f.pointer('pointermove',1,400+drift,400);
    f.pointer('pointerup',1,401+drift,400);
    expect(rotationOf(f.image)).not.toBe(0);
    f.settleSpring();
    expect(rotationOf(f.image)).toBe(0);
    expect(f.image.style.transform).toContain(`scale(${scale})`);
    expect(f.dialog.open).toBe(true);
  }
});

test('dismissal scale follows drag and pinch progress, reverses, and returns to full size', () => {
  const f=fixture(); f.click();
  const scale=()=>Number(/scale\(([^)]+)\)/.exec(f.image.style.transform)![1]);
  f.pointer('pointerdown',1,400,400); f.pointer('pointermove',1,466,400);
  expect(scale()).toBeCloseTo(.96);
  f.pointer('pointermove',1,550,400); expect(scale()).toBeCloseTo(.92);
  f.pointer('pointermove',1,400,400); expect(scale()).toBe(1);
  f.pointer('pointerup',1,400,400); f.settleSpring(); expect(scale()).toBe(1);
  f.pointer('pointerdown',2,400,400); f.pointer('pointerdown',3,600,400);
  f.pointer('pointermove',2,420,400); f.pointer('pointermove',3,580,400);
  expect(scale()).toBeCloseTo(.8 * .936);
  f.pointer('pointercancel',2,420,400); f.pointer('pointerup',3,580,400);
  f.settleSpring(); expect(scale()).toBe(1); expect(f.dialog.open).toBe(true);
});

test('zooming in and back out cannot become pinch dismissal or a remaining-finger dismissal drag', () => {
  const f=fixture(); f.click();
  f.pointer('pointerdown',1,400,400); f.pointer('pointerdown',2,600,400);
  f.pointer('pointermove',1,300,400); f.pointer('pointermove',2,700,400);
  f.pointer('pointermove',1,480,400); f.pointer('pointermove',2,520,400);
  expect(f.image.style.transform).toContain('scale(1)');
  expect(Number(f.image.style.opacity)).toBe(1);
  f.pointer('pointerup',2,520,400);
  f.pointer('pointermove',1,1000,400); f.pointer('pointerup',1,1000,400);
  f.settleSpring(); expect(f.dialog.open).toBe(true);
  f.pointer('pointerdown',3,400,400); f.pointer('pointermove',3,600,400); f.pointer('pointerup',3,600,400);
  f.tick(150); expect(f.dialog.open).toBe(false);
});

test('trackpad wheel pinch must end before a separate inward pinch can dismiss', () => {
  const f=fixture(); f.click();
  f.wheel(-100,true);
  for(let i=0;i<8;i++) f.wheel(100,true);
  expect(f.image.style.transform).toContain('scale(1)');
  f.tick(160); f.tick(150); expect(f.dialog.open).toBe(true);
  f.wheel(100,true); f.wheel(100,true); f.tick(160); f.tick(150);
  expect(f.dialog.open).toBe(false);
});

test('Safari zooming out stops at fit until a new gesture begins', () => {
  const f=fixture(); f.click(); f.gesture('gesturestart');
  f.gesture('gesturechange',2); f.gesture('gesturechange',.5);
  expect(f.image.style.transform).toContain('scale(1)');
  f.gesture('gestureend',.5); f.tick(150); expect(f.dialog.open).toBe(true);
  f.gesture('gesturestart'); f.gesture('gesturechange',.7); f.gesture('gestureend',.7);
  f.tick(150); expect(f.dialog.open).toBe(false);
});

function loadersFor(f: ReturnType<typeof fixture>) {
  const loaders: { image: HTMLImageElement; resolve: () => void; reject: () => void }[] = [];
  const create = f.document.createElement.bind(f.document);
  f.document.createElement = ((name: string) => {
    const node = create(name);
    if (name === 'img') {
      const image = node as HTMLImageElement;
      let resolve!: () => void;
      let reject!: () => void;
      const decoded = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error('decode failed')); });
      Object.defineProperties(image, { complete: { value: true, configurable: true }, naturalWidth: { value: 7200 }, naturalHeight: { value: 4800 } });
      image.decode = () => decoded;
      loaders.push({ image, resolve, reject });
    }
    return node;
  }) as typeof f.document.createElement;
  return loaders;
}

const demoSeen = 'vcd:image-lightbox-demo-seen';
const demoPointer = (f: ReturnType<typeof fixture>, which = 'one') => f.viewer.querySelector<HTMLElement>(`[data-image-lightbox-demo-pointer="${which}"]`)!;
const scaleOf = (f: ReturnType<typeof fixture>) => Number(f.image.style.transform.match(/scale\(([^)]+)\)/)![1]);
const panOf = (f: ReturnType<typeof fixture>) => Number(f.image.style.transform.match(/translate\(([^p]+)px/)![1]);
const panYOf = (f: ReturnType<typeof fixture>) => Number(f.image.style.transform.match(/translate\([^,]+, ([-\d.e+]+)px/)![1]);
const pointerX = (f: ReturnType<typeof fixture>, which = 'two') => Number(demoPointer(f, which).style.transform.match(/translate\(([-\d.]+)px/)![1]);
const pointerY = (f: ReturnType<typeof fixture>, which = 'two') => Number(demoPointer(f, which).style.transform.match(/, ([-\d.]+)px/)![1]);
const startDemo = (f: ReturnType<typeof fixture>) => { f.click(); f.frame(); f.frame(); f.tick(250); f.frame(); };
const advance = (f: ReturnType<typeof fixture>, ms: number) => { f.tick(ms); f.frame(); };

test('cached preview appears immediately; original replaces it only after load and decode', async () => {
  const f = fixture(false, { loaded: true, preview: '/images/study.preview.webp' });
  const loaders = loadersFor(f);
  f.click();
  expect(f.image.getAttribute('src')).toBe('/images/study.preview.webp');
  expect(f.image.style.getPropertyValue('--image-aspect')).toBe('1.5');
  loaders[0].image.dispatchEvent(new f.window.Event('load'));
  await Promise.resolve();
  expect(f.image.getAttribute('src')).toBe('/images/study.preview.webp');
  loaders[0].resolve(); await Promise.resolve(); await Promise.resolve();
  expect(f.image.getAttribute('src')).toBe('/images/study.jpg');
  expect(f.image.style.getPropertyValue('--image-aspect')).toBe('1.5');
});

test('already-loaded original URL avoids a redundant loader', () => {
  const f = fixture(false, { loaded: true, preview: 'http://localhost:4323/images/study.jpg' });
  const loaders = loadersFor(f); f.click();
  expect(loaders.length).toBe(0);
});

for (const reject of [false, true]) {
  test(`stale original ${reject ? 'decode failure' : 'decode completion'} cannot affect a reopened lightbox`, async () => {
    const f = fixture(false, { loaded: true, preview: '/images/study.preview.webp' });
    const loaders = loadersFor(f);
    f.click(); loaders[0].image.dispatchEvent(new f.window.Event('load'));
    f.key('Escape'); f.tick(150); f.original.dataset.imageOriginal = '/images/next.jpg'; f.click();
    reject ? loaders[0].reject() : loaders[0].resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(f.image.getAttribute('src')).toBe('/images/study.preview.webp');
    expect(f.dialog.querySelector<HTMLElement>('[data-image-lightbox-error]')!.hidden).toBe(true);
    loaders[1].image.dispatchEvent(new f.window.Event('load')); loaders[1].resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(f.image.getAttribute('src')).toBe('/images/next.jpg');
  });
}

for (const decodeError of [false, true]) {
  test(`${decodeError ? 'decode' : 'network'} failure keeps the preview and reports the unavailable original`, async () => {
    const f = fixture(false, { loaded: true, preview: '/images/study.preview.webp' });
    const loaders = loadersFor(f); f.click();
    if (decodeError) { loaders[0].image.dispatchEvent(new f.window.Event('load')); loaders[0].reject(); }
    else loaders[0].image.dispatchEvent(new f.window.Event('error'));
    await Promise.resolve(); await Promise.resolve();
    expect(f.image.getAttribute('src')).toBe('/images/study.preview.webp');
    const error = f.dialog.querySelector<HTMLElement>('[data-image-lightbox-error]')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Full-resolution image could not be loaded.');
  });
}

test('walkthrough spreads two fingers, pans, releases at fit, then pinches again to close', () => {
  const f = fixture(false, { loaded: true }); startDemo(f);
  expect(pointerY(f, 'one')).not.toBe(pointerY(f, 'two'));
  expect(f.window.sessionStorage.getItem(demoSeen)).toBe('1');
  const initial = demoPointer(f).style.transform;
  advance(f, 700); expect(scaleOf(f)).toBeGreaterThan(2); expect(demoPointer(f).style.transform).not.toBe(initial);
  advance(f, 700); expect(panOf(f)).toBeGreaterThan(0); expect(scaleOf(f)).toBe(2.3);
  expect(demoPointer(f, 'two').classList.contains('is-visible')).toBe(true);
  advance(f, 1400); expect(scaleOf(f)).toBe(1);
  expect(demoPointer(f).classList.contains('is-visible')).toBe(true);
  advance(f, 700); expect(scaleOf(f)).toBeLessThan(.75); expect(f.image.classList.contains('is-armed')).toBe(true);
  advance(f, 249); expect(f.dialog.classList.contains('is-visible')).toBe(true);
  advance(f, 1); expect(f.dialog.classList.contains('is-visible')).toBe(false);
  f.tick(149); expect(f.dialog.open).toBe(true);
  f.tick(1); expect(f.dialog.open).toBe(false);
  f.click(); f.frame(); f.frame(); advance(f, 10000);
  expect(f.dialog.open).toBe(true); expect(demoPointer(f).classList.contains('is-visible')).toBe(false);
  const sameTab = fixture(false, { loaded: true, session: f.window.sessionStorage }); startDemo(sameTab);
  expect(demoPointer(sameTab).classList.contains('is-visible')).toBe(false);
  const newTab = fixture(false, { loaded: true }); startDemo(newTab);
  expect(demoPointer(newTab).classList.contains('is-visible')).toBe(true);
});

test('coarse walkthrough keeps the right finger through pan while the left finger fades', () => {
  const f = fixture(false, { loaded: true, coarse: true }); startDemo(f);
  advance(f, 1300);
  expect(demoPointer(f, 'two').classList.contains('is-visible')).toBe(true);
  expect(demoPointer(f).classList.contains('is-visible')).toBe(false);
  const pan = demoPointer(f, 'two').style.transform;
  advance(f, 700);
  expect(demoPointer(f, 'two').style.transform).not.toBe(pan);
  expect(demoPointer(f).classList.contains('is-visible')).toBe(false);
  advance(f, 700);
  expect(demoPointer(f, 'one').classList.contains('is-visible')).toBe(true);
  expect(demoPointer(f, 'two').classList.contains('is-visible')).toBe(true);
});

test('first zoom-out keeps the fingers visibly separated around the focal point', () => {
  const f = fixture(false, { loaded: true }); startDemo(f);
  advance(f, 2050);
  const startDistance = Math.hypot(pointerX(f, 'two') - pointerX(f, 'one'), pointerY(f, 'two') - pointerY(f, 'one'));
  advance(f, 750);
  const endDistance = Math.hypot(pointerX(f, 'two') - pointerX(f, 'one'), pointerY(f, 'two') - pointerY(f, 'one'));
  expect(startDistance).toBeGreaterThan(200);
  expect(startDistance - endDistance).toBeGreaterThan(50);
  expect(endDistance).toBeGreaterThan(90);
  const phone = fixture(false, { loaded: true, coarse: true, width: 320 }); startDemo(phone);
  advance(phone, 2050);
  expect(pointerX(phone, 'two') + 44).toBeLessThanOrEqual(320);
});

for (const coarse of [false, true]) {
  test(`${coarse ? 'coarse' : 'desktop'} walkthrough keeps right pointer coordinates continuous`, () => {
    for (const boundary of [1100, 1250, 1900, 2050, 2800, 3100]) {
      const f = fixture(false, { loaded: true, coarse }); startDemo(f);
      advance(f, boundary - 1);
      const imageBefore = panOf(f);
      const imageYBefore = panYOf(f);
      const rightBefore = pointerX(f);
      const rightYBefore = pointerY(f);
      const leftBefore = pointerX(f, 'one');
      const leftYBefore = pointerY(f, 'one');
      const leftVisible = demoPointer(f).classList.contains('is-visible');
      expect(demoPointer(f, 'two').classList.contains('is-visible')).toBe(true);
      advance(f, 2);
      expect(demoPointer(f, 'two').classList.contains('is-visible')).toBe(true);
      expect(Math.abs(panOf(f) - imageBefore)).toBeLessThan(1);
      expect(Math.abs(panYOf(f) - imageYBefore)).toBeLessThan(1);
      expect(Math.abs(pointerX(f) - rightBefore)).toBeLessThan(3);
      expect(Math.abs(pointerY(f) - rightYBefore)).toBeLessThan(3);
      if (leftVisible && demoPointer(f).classList.contains('is-visible')) {
        expect(Math.abs(pointerX(f, 'one') - leftBefore)).toBeLessThan(3);
        expect(Math.abs(pointerY(f, 'one') - leftYBefore)).toBeLessThan(3);
      }
    }
  });
}

test('walkthrough moves to distinct focal points and closes off-center independently of frame rate', () => {
  const f = fixture(false, { loaded: true }); startDemo(f);
  const fingerMidpoint = () => ({ x: (pointerX(f, 'one') + pointerX(f, 'two')) / 2, y: (pointerY(f, 'one') + pointerY(f, 'two')) / 2 });
  const opening = fingerMidpoint();
  advance(f, 700); expect(panOf(f)).toBeLessThan(0);
  advance(f, 550); const pan = fingerMidpoint();
  expect(Math.hypot(pan.x - opening.x, pan.y - opening.y)).toBeGreaterThan(20);
  advance(f, 800); const zoomOut = fingerMidpoint();
  expect(Math.hypot(zoomOut.x - pan.x, zoomOut.y - pan.y)).toBeGreaterThan(20);
  advance(f, 1050); const closing = fingerMidpoint();
  expect(Math.hypot(closing.x - zoomOut.x, closing.y - zoomOut.y)).toBeGreaterThan(20);
  advance(f, 300); expect(panOf(f)).toBeGreaterThan(0); expect(panYOf(f)).toBeGreaterThan(0);
  const sparse = fixture(false, { loaded: true }); startDemo(sparse); advance(sparse, 3400);
  const frequent = fixture(false, { loaded: true }); startDemo(frequent);
  for (let elapsed = 0; elapsed < 3400; elapsed += 20) advance(frequent, 20);
  expect(sparse.image.style.transform).toBe(frequent.image.style.transform);
});

const dismissalCases = [
  { method: 'tap', coarse: false, selection: .1 },
  { method: 'pan', coarse: false, selection: .5 },
  { method: 'pinch', coarse: false, selection: .9 },
  { method: 'swipe', coarse: true, selection: .1 },
];
const endingFixture = (choice: typeof dismissalCases[number], angle = .125) => {
  let calls = 0;
  const f = fixture(false, { loaded: true, coarse: choice.coarse, imageHeight: 480, random: () => (++calls === 1 && !choice.coarse ? choice.selection : angle) });
  return { f, calls: () => calls };
};

for (const choice of dismissalCases) {
  test(`${choice.method} ending keeps continuous fingers, correct count, fixed randomness and normal close timing`, () => {
    const { f, calls } = endingFixture(choice); startDemo(f);
    advance(f, 3099); const before = { x: pointerX(f), y: pointerY(f) };
    advance(f, 2);
    expect(Math.hypot(pointerX(f) - before.x, pointerY(f) - before.y)).toBeLessThan(3);
    advance(f, 99);
    expect(demoPointer(f).classList.contains('is-visible')).toBe(choice.method === 'pan' || choice.method === 'pinch');
    expect(demoPointer(f, 'two').classList.contains('is-visible')).toBe(true);
    if (choice.method === 'tap') {
      expect(pointerY(f) + 22).toBeLessThan((600 - 480) / 2);
      expect(pointerY(f) + 22).toBeGreaterThan(0);
      expect(scaleOf(f)).toBe(1); expect(panOf(f)).toBe(0);
      advance(f, 139); expect(f.dialog.classList.contains('is-visible')).toBe(true);
      advance(f, 1);
    } else {
      if (choice.method === 'pinch') expect(scaleOf(f)).toBeLessThan(1);
      else expect(Math.hypot(panOf(f), panYOf(f))).toBeGreaterThan(0);
      advance(f, 300); expect(f.image.classList.contains('is-armed')).toBe(true);
      advance(f, 249); expect(f.dialog.classList.contains('is-visible')).toBe(true);
      advance(f, 1);
    }
    expect(f.dialog.classList.contains('is-visible')).toBe(false);
    f.tick(149); expect(f.dialog.open).toBe(true);
    f.tick(1); expect(f.dialog.open).toBe(false);
    expect(calls()).toBe(choice.coarse ? 1 : 2);
  });

  test(`${choice.method} ending is independent of animation frame frequency`, () => {
    const { f: sparse } = endingFixture(choice); startDemo(sparse); advance(sparse, 3200);
    const { f: frequent } = endingFixture(choice); startDemo(frequent);
    for (let elapsed = 0; elapsed < 3200; elapsed += 20) advance(frequent, 20);
    expect(sparse.image.style.transform).toBe(frequent.image.style.transform);
    expect(demoPointer(sparse, 'two').style.transform).toBe(demoPointer(frequent, 'two').style.transform);
  });

  for (const input of ['pointer', 'key']) {
    test(`${input} interrupts ${choice.method} ending without a delayed close`, () => {
      const { f } = endingFixture(choice); startDemo(f); advance(f, 3200);
      input === 'pointer' ? f.pointer('pointerdown', 1) : f.key('a');
      expect(demoPointer(f, 'two').classList.contains('is-visible')).toBe(false);
      advance(f, 10000); f.tick(1000); expect(f.dialog.open).toBe(true);
    });
  }
}

for (const method of ['swipe', 'pan']) {
  test(`${method} dismissal can move in opposite random directions`, () => {
    const choice = dismissalCases.find((entry) => entry.method === method)!;
    const { f: right } = endingFixture(choice, 0); startDemo(right); advance(right, 3400);
    const { f: left } = endingFixture(choice, .5); startDemo(left); advance(left, 3400);
    expect(panOf(right)).toBeGreaterThan(0); expect(panOf(left)).toBeLessThan(0);
    expect(panOf(right)).toBeCloseTo(-panOf(left), 6);
  });

  for (const [direction, angle] of [['right', 0], ['left', .5], ['vertical', .25], ['diagonal', .125]] as const) {
    test(`${method} demo tilt matches native ${direction} dismissal, including the tilt limit`, () => {
      const choice = dismissalCases.find((entry) => entry.method === method)!;
      const { f: demo } = endingFixture(choice, angle); startDemo(demo);
      const native = fixture(false, { loaded: true, imageHeight: 480 });
      if (method === 'pan') {
        const select = native.viewer.querySelector<HTMLSelectElement>('[data-image-lightbox-input-mode]')!;
        select.value = 'trackpad'; select.dispatchEvent(new native.window.Event('change', { bubbles: true }));
      }
      native.click();
      if (method === 'swipe') native.pointer('pointerdown', 1, 400, 400);
      let previousX = 0; let previousY = 0;
      advance(demo, 3100);
      for (const elapsed of [200, 249]) {
        advance(demo, elapsed);
        const dx = panOf(demo); const dy = panYOf(demo);
        if (method === 'swipe') native.pointer('pointermove', 1, 400 + dx, 400 + dy);
        else native.wheel(previousY - dy, false, 0, 500, 400, previousX - dx);
        expect(rotationOf(demo.image)).toBeCloseTo(rotationOf(native.image), 5);
        expect(Math.abs(rotationOf(demo.image))).toBeLessThanOrEqual(12);
        previousX = dx; previousY = dy;
      }
      if (direction === 'right') expect(rotationOf(demo.image)).toBe(12);
      if (direction === 'left') expect(rotationOf(demo.image)).toBe(-12);
      if (direction === 'vertical') expect(rotationOf(demo.image)).toBeCloseTo(0, 5);
    });
  }
}

for (const elapsed of [700, 1600, 2900, 3400]) {
  for (const input of ['pointer', 'wheel', 'key', 'gesture', 'select']) {
    test(`${input} interrupts walkthrough at ${elapsed}ms without a delayed close`, () => {
      const f = fixture(false, { loaded: true }); startDemo(f); advance(f, elapsed);
      const previous = f.image.style.transform;
      if (input === 'pointer') f.pointer('pointerdown', 1);
      else if (input === 'wheel') f.wheel(0);
      else if (input === 'key') f.key('a');
      else if (input === 'gesture') f.gesture('gesturestart');
      else f.viewer.querySelector('select')!.dispatchEvent(new f.window.Event('change'));
      expect(f.dialog.open).toBe(true);
      expect(demoPointer(f).classList.contains('is-visible')).toBe(false);
      if (elapsed < 3100) expect(f.image.style.transform).toBe(previous);
      advance(f, 10000); f.tick(1000);
      expect(f.dialog.open).toBe(true);
    });
  }
}

test('early input before loading or during the wait prevents later playback without claiming seen', () => {
  for (const loaded of [false, true]) {
    const f = fixture(false, { loaded }); f.click(); f.frame(); f.frame();
    f.pointer('pointerdown', 1); f.pointer('pointerup', 1);
    if (!loaded) Object.defineProperties(f.image, { complete: { value: true }, naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
    f.image.dispatchEvent(new f.window.Event('load'));
    advance(f, 10000); f.tick(150);
    expect(f.dialog.open).toBe(true);
    expect(f.window.sessionStorage.getItem(demoSeen)).toBeNull();
  }
});

test('repeated image loads schedule only one visible walkthrough; a source swap does not cancel it', () => {
  const f = fixture(false, { loaded: true }); f.click(); f.frame(); f.frame();
  for (let i = 0; i < 3; i++) f.image.dispatchEvent(new f.window.Event('load'));
  expect(f.timers.size).toBe(1); expect(f.window.sessionStorage.getItem(demoSeen)).toBeNull();
  f.tick(250); f.frame(); expect(demoPointer(f).classList.contains('is-visible')).toBe(true);
  Object.defineProperty(f.image, 'complete', { value: false, configurable: true });
  advance(f, 1000); expect(scaleOf(f)).toBeGreaterThan(1);
  expect(demoPointer(f).classList.contains('is-visible')).toBe(true);
  Object.defineProperty(f.image, 'complete', { value: true, configurable: true });
  f.image.dispatchEvent(new f.window.Event('load'));
  expect(f.timers.size).toBe(0); expect(f.frames.size).toBe(1);
});

test('walkthrough pan covers the same distance with sparse or frequent animation frames', () => {
  const sparse = fixture(false, { loaded: true }); startDemo(sparse); advance(sparse, 1600);
  const frequent = fixture(false, { loaded: true }); startDemo(frequent);
  for (let elapsed = 0; elapsed < 1600; elapsed += 20) advance(frequent, 20);
  expect(panOf(sparse)).toBeCloseTo(panOf(frequent), 6);
  expect(scaleOf(sparse)).toBe(scaleOf(frequent));
});

test('keyboard and reduced-motion openings skip and do not claim the walkthrough', () => {
  const keyboard = fixture(false, { loaded: true }); keyboard.key('Enter', keyboard.original);
  keyboard.frame(); keyboard.frame(); advance(keyboard, 10000);
  expect(keyboard.window.sessionStorage.getItem(demoSeen)).toBeNull();
  expect(keyboard.dialog.open).toBe(true);
  const reduced = fixture(true, { loaded: true }); startDemo(reduced); advance(reduced, 10000);
  expect(reduced.window.sessionStorage.getItem(demoSeen)).toBeNull(); expect(reduced.dialog.open).toBe(true);
});

test('resize and disposal cancel demonstration frames and timers', () => {
  const f = fixture(false, { loaded: true }); startDemo(f); advance(f, 700);
  f.window.dispatchEvent(new f.window.Event('resize')); advance(f, 10000);
  expect(f.dialog.open).toBe(true); expect(demoPointer(f).classList.contains('is-visible')).toBe(false);
  f.dispose(); expect(f.dialog.open).toBe(false); expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
});

test('mobile removes side insets and fit geometry uses image aspect and the safe viewport', () => {
  const css = readFileSync(new URL('../../src/components/ImageLightbox.astro', import.meta.url), 'utf8').split('<style>')[1];
  expect(css).toContain('padding-inline: 0');
  expect(css).toContain('width: min(100%, calc(var(--vh-safe, 1svh) * 80 * var(--image-aspect, 1)))');
  expect(css).toContain('aspect-ratio: var(--image-aspect, auto)');
});
