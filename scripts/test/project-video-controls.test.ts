import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { sizeIcon } from '../../src/lib/icons';
import { createPageScope } from '../../src/lib/pageLifecycle';
import { resolveVideoAudio } from '../../src/lib/videoAudio';

const window = new Window({ url: 'http://localhost:4322' });
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLVideoElement', 'HTMLMediaElement', 'DocumentFragment', 'EventTarget', 'Event', 'CustomEvent', 'MutationObserver', 'ResizeObserver', 'customElements', 'localStorage', 'navigator', 'DOMParser']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? window : (window as any)[key] });
}
Object.assign(globalThis, {
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});
// Happy DOM cannot parse ::slotted here; playback tests do not depend on CSS matching.
const insertRule = window.CSSStyleSheet.prototype.insertRule;
window.CSSStyleSheet.prototype.insertRule = function(rule: string, index?: number) {
  return insertRule.call(this, rule.replace(/, ::slotted\([^)]*\)/g, '').replace(/\{\s*\}$/, '{ color: white; }'), index);
};
await import('media-chrome');
const source = readFileSync(new URL('../../src/lib/projectVideoControls.ts', import.meta.url), 'utf8');
const projectStyle = readFileSync(new URL('../../src/styles/project.css', import.meta.url), 'utf8');
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function'));
const svg = (name: string) => readFileSync(new URL(`../../node_modules/lucide-static/icons/${name}.svg`, import.meta.url), 'utf8');
const env = { createPageScope, resolveVideoAudio, sizeIcon, playIcon: svg('play'), pauseIcon: svg('pause'), volumeIcon: svg('volume-2'), muteIcon: svg('volume-x') };
const { enhanceProjectVideo, bindVideoVisibility, bindVideoPoster } = new Function('env', `with(env) { ${code}; return { enhanceProjectVideo, bindVideoVisibility, bindVideoPoster }; }`)(env);
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 20)); };

test('poster gate primes paused playback, fades after decoded frames, then starts video', async () => {
  const controller = window.document.createElement('div');
  const video = window.document.createElement('video');
  video.poster = '/poster.webp';
  let playCalls = 0;
  let pauseCalls = 0;
  let readyState = 2;
  let videoWidth = 0;
  Object.defineProperties(video, {
    readyState: { configurable: true, get: () => readyState },
    videoWidth: { configurable: true, get: () => videoWidth },
  });
  video.play = () => { playCalls++; return Promise.resolve(); };
  video.pause = () => { pauseCalls++; };
  let finishFade!: () => void;
  const fade = new Promise<void>((resolve) => { finishFade = resolve; });
  const poster = window.document.createElement('img');
  poster.animate = (() => ({ finished: fade, cancel() {} })) as any;
  controller.append(video);
  window.document.body.append(controller);
  const scope = createPageScope();
  // The helper creates the real poster; patch its animation seam after insertion.
  const start = bindVideoPoster(video, controller, scope)!;
  const renderedPoster = controller.querySelector('.project-video-player__poster') as HTMLImageElement;
  renderedPoster.animate = poster.animate;

  controller.dispatchEvent(new window.Event('mediaplayrequest', { bubbles: true }));
  expect(playCalls).toBe(1);
  expect(pauseCalls).toBe(1);
  expect(renderedPoster.hidden).toBe(false);
  readyState = 3; videoWidth = 640;
  video.dispatchEvent(new window.Event('canplay'));
  await settle();
  expect(playCalls).toBe(1);
  finishFade();
  await settle();
  expect(playCalls).toBe(2);
  expect(renderedPoster.hidden).toBe(true);
  scope.destroy();
  expect(controller.querySelector('.project-video-player__poster')).toBeNull();
});

test('poster stays opaque while current data is insufficient', async () => {
  const controller = window.document.createElement('div');
  const video = window.document.createElement('video');
  video.poster = '/poster.webp';
  let readyState = 2;
  let videoWidth = 0;
  let animations = 0;
  Object.defineProperties(video, {
    readyState: { configurable: true, get: () => readyState },
    videoWidth: { configurable: true, get: () => videoWidth },
  });
  video.play = () => Promise.resolve();
  video.pause = () => {};
  controller.append(video); window.document.body.append(controller);
  const scope = createPageScope();
  bindVideoPoster(video, controller, scope);
  const poster = controller.querySelector('.project-video-player__poster') as HTMLImageElement;
  poster.animate = (() => { animations++; return { finished: Promise.resolve(), cancel() {} }; }) as any;
  controller.dispatchEvent(new window.Event('mediaplayrequest', { bubbles: true }));
  video.dispatchEvent(new window.Event('canplay'));
  await settle();
  expect(animations).toBe(0);
  expect(poster.hidden).toBe(false);
  readyState = 3; videoWidth = 640;
  controller.dispatchEvent(new window.Event('mediapauserequest', { bubbles: true }));
  expect(poster.hidden).toBe(false);
  scope.destroy();
});

test('videos without posters keep native playback requests unchanged', () => {
  const controller = window.document.createElement('div');
  const video = window.document.createElement('video');
  let playCalls = 0;
  video.play = () => { playCalls++; return Promise.resolve(); };
  controller.append(video); window.document.body.append(controller);
  const scope = createPageScope();
  expect(bindVideoPoster(video, controller, scope)).toBeNull();
  video.play();
  expect(playCalls).toBe(1);
  scope.destroy();
});

test('canceling a poster fade prevents stale playback and resets the source poster', async () => {
  const controller = window.document.createElement('div');
  const video = window.document.createElement('video');
  video.poster = '/first.webp';
  let readyState = 3;
  let videoWidth = 640;
  let playCalls = 0;
  Object.defineProperties(video, {
    readyState: { configurable: true, get: () => readyState },
    videoWidth: { configurable: true, get: () => videoWidth },
  });
  video.play = () => { playCalls++; return Promise.resolve(); };
  video.pause = () => {};
  let finishFade!: () => void;
  const fade = new Promise<void>((resolve) => { finishFade = resolve; });
  controller.append(video); window.document.body.append(controller);
  const scope = createPageScope();
  bindVideoPoster(video, controller, scope);
  const poster = controller.querySelector('.project-video-player__poster') as HTMLImageElement;
  poster.animate = (() => ({ finished: fade, cancel() {} })) as any;
  controller.dispatchEvent(new window.Event('mediaplayrequest', { bubbles: true }));
  await settle();
  controller.dispatchEvent(new window.Event('mediapauserequest', { bubbles: true }));
  finishFade();
  await settle();
  expect(playCalls).toBe(1);
  video.poster = '/second.webp';
  video.dispatchEvent(new window.Event('emptied'));
  expect(poster.src).toContain('/second.webp');
  expect(poster.hidden).toBe(false);
  readyState = 0; videoWidth = 0;
  scope.destroy();
});

test('reduced motion removes the poster fade duration', async () => {
  const previousMatchMedia = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  try {
    const controller = window.document.createElement('div');
    const video = window.document.createElement('video');
    video.poster = '/poster.webp';
    Object.defineProperties(video, {
      readyState: { configurable: true, get: () => 3 },
      videoWidth: { configurable: true, get: () => 640 },
    });
    video.play = () => Promise.resolve(); video.pause = () => {};
    controller.append(video); window.document.body.append(controller);
    const scope = createPageScope();
    bindVideoPoster(video, controller, scope);
    const poster = controller.querySelector('.project-video-player__poster') as HTMLImageElement;
    let options: KeyframeAnimationOptions | undefined;
    poster.animate = ((_keyframes: Keyframe[] | PropertyIndexedKeyframes, next: KeyframeAnimationOptions) => {
      options = next;
      return { finished: Promise.resolve(), cancel() {} };
    }) as any;
    controller.dispatchEvent(new window.Event('mediaplayrequest', { bubbles: true }));
    await settle();
    expect(options?.duration).toBe(0);
    scope.destroy();
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: previousMatchMedia });
  }
});

test('inactivity hiding is touch-only, while keyboard popup access stays global', () => {
  const sheet = new window.CSSStyleSheet();
  sheet.replaceSync(projectStyle);
  const rules: { selector: string; media: string; style: CSSStyleDeclaration }[] = [];
  const visit = (list: CSSRuleList, media = '') => {
    for (const rule of list as any) {
      if (rule.selectorText) rules.push({ selector: rule.selectorText, media, style: rule.style });
      if (rule.cssRules) visit(rule.cssRules, rule.conditionText || media);
    }
  };
  visit(sheet.cssRules as unknown as CSSRuleList);
  const inactive = rules.filter((rule) => rule.selector.includes('.project-video-player__controller[userinactive]'));
  expect(inactive.length).toBeGreaterThan(0);
  for (const rule of inactive) {
    expect(rule.media).toBe('(hover: none), (pointer: coarse)');
    expect(rule.style.getPropertyValue('pointer-events')).toBe('none');
    expect(rule.style.getPropertyValue('transition-delay')).toBe('0s');
  }
  const hover = rules.filter((rule) => rule.selector.includes('.project-video-player__controller:hover .project-video-player__'));
  expect(hover.length).toBeGreaterThan(0);
  expect(hover.every((rule) => rule.media === '(hover: hover) and (pointer: fine)')).toBe(true);
  expect(rules.some((rule) => !rule.media && rule.selector.includes('.project-video-player__volume-group:has(:focus-visible') && rule.style.opacity === '1')).toBe(true);
  const dotHover = rules.filter((rule) => rule.selector.includes('.project-image-carousel') && rule.selector.includes('controller:hover'));
  expect(dotHover.length).toBeGreaterThan(0);
  expect(dotHover.every((rule) => rule.media === '(hover: hover) and (pointer: fine)')).toBe(true);
  const coarseDots = rules.filter((rule) => rule.selector.includes('.project-image-carousel') && rule.media === '(hover: none), (pointer: coarse)');
  expect(coarseDots.some((rule) => rule.style.getPropertyValue('--project-carousel-controls-presence') === '0')).toBe(true);
  expect(coarseDots.some((rule) => rule.selector.includes('[data-carousel-current]') && rule.selector.includes(':not([userinactive])') && rule.style.getPropertyValue('--project-carousel-controls-presence') === '1')).toBe(true);
  expect(coarseDots.some((rule) => rule.selector.includes('[data-carousel-current]') && rule.selector.includes('[mediapaused]') && rule.style.getPropertyValue('--project-carousel-controls-presence') === '1')).toBe(true);
  const nativeFallback = rules.filter((rule) => rule.selector.includes('video[data-project-inline-video][controls]'));
  expect(nativeFallback.length).toBeGreaterThan(0);
  expect(nativeFallback.every((rule) => rule.style.position === 'absolute')).toBe(true);
  expect(nativeFallback.every((rule) => rule.style.width === '100%' && rule.style.height === '100%')).toBe(true);
  expect(nativeFallback.every((rule) => rule.style.objectFit === 'cover' && rule.style.transform === 'none')).toBe(true);
});

for (const existing of [false, true]) {
  test(`${existing ? 'standalone' : 'inline'} video shares one functioning controller`, async () => {
    const root = window.document.createElement('div');
    root.innerHTML = existing
      ? '<media-controller novolumepref nomutedpref><video controls data-project-inline-video slot="media"></video></media-controller>'
      : '<video controls data-project-inline-video></video>';
    const video = root.querySelector('video')!;
    video.remote.cancelWatchAvailability = async () => {};
    // Happy DOM does not emit the browser's volumechange events from these setters.
    for (const property of ['volume', 'muted']) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, property)!;
      Object.defineProperty(video, property, {
        get: () => descriptor.get!.call(video),
        set: (value) => {
          descriptor.set!.call(video, value);
          video.dispatchEvent(new window.Event('volumechange'));
        },
      });
    }
    window.document.body.append(root);
    enhanceProjectVideo(video);
    enhanceProjectVideo(video);
    await settle();
    const controller = root.querySelector('media-controller')! as any;
    expect(root.querySelectorAll('media-controller')).toHaveLength(1);
    expect(root.querySelectorAll('media-play-button')).toHaveLength(1);
    expect(root.querySelector('media-play-button svg')?.getAttribute('fill')).toBe('currentColor');
    expect(controller.media).toBe(video);
    expect(video.controls).toBe(false);
    expect(video.volume).toBe(0.5);
    expect(root.querySelector('media-volume-range')?.shadowRoot?.querySelector('input')?.getAttribute('aria-orientation')).toBe('vertical');
    expect([...root.querySelectorAll('media-mute-button svg')].map((node) => node.getAttribute('slot'))).toEqual(['off', 'low', 'medium', 'high']);
    root.querySelector('media-mute-button')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    expect(video.muted).toBe(true);
    const volumeInput = root.querySelector('media-volume-range')!.shadowRoot!.querySelector('input')!;
    volumeInput.value = '0.4';
    volumeInput.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }));
    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(false);
    for (const range of root.querySelectorAll('media-time-range, media-volume-range')) {
      const input = range.shadowRoot!.querySelector('input')!;
      const matches = input.matches.bind(input);
      let keyboardFocus = false;
      input.matches = (selector: string) => selector === ':focus-visible' ? keyboardFocus : matches(selector);
      input.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true, composed: true }));
      expect(range.hasAttribute('data-video-keyboard-focus')).toBe(false);
      keyboardFocus = true;
      input.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true, composed: true }));
      expect(range.hasAttribute('data-video-keyboard-focus')).toBe(true);
      input.dispatchEvent(new window.PointerEvent('pointerdown', { button: 1, bubbles: true, composed: true }));
      expect(range.hasAttribute('data-video-keyboard-focus')).toBe(false);
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true }));
      expect(range.hasAttribute('data-video-keyboard-focus')).toBe(true);
      input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, composed: true }));
      expect(range.hasAttribute('data-video-keyboard-focus')).toBe(false);
      input.matches = matches;
    }
    const progress = root.querySelector('media-time-range')!;
    let bufferedRanges = [[0, 5]];
    Object.defineProperty(video, 'duration', { get: () => 100 });
    Object.defineProperty(video, 'buffered', { get: () => ({
      length: bufferedRanges.length,
      start: (index: number) => bufferedRanges[index][0],
      end: (index: number) => bufferedRanges[index][1],
    }) });
    const bufferedPaint = () => decodeURIComponent(progress.style.getPropertyValue('--project-video-buffered-ranges'));
    video.dispatchEvent(new window.Event('progress'));
    await settle();
    expect(bufferedPaint()).toContain('width="5%"');
    expect(bufferedPaint()).toContain('rx="3"');
    bufferedRanges = [[0, 15], [60, 75]];
    video.dispatchEvent(new window.Event('timeupdate'));
    await settle();
    expect(bufferedPaint()).toContain('width="15%"');
    expect(bufferedPaint()).toContain('x="60%"');
    expect(bufferedPaint().match(/<rect /g)).toHaveLength(2);
    const allSections = bufferedPaint();
    for (const time of [0, 1, 40, 70]) {
      video.currentTime = time;
      video.dispatchEvent(new window.Event('seeked'));
      await settle();
      expect(bufferedPaint()).toBe(allSections);
    }
    bufferedRanges = [];
    video.dispatchEvent(new window.Event('emptied'));
    await settle();
    expect(bufferedPaint()).not.toContain('<rect ');
    const mute = root.querySelector('media-mute-button')!;
    mute.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.4);
    await settle();
    root.querySelector('media-volume-range')!.setAttribute('mediamuted', '');
    await settle();
    expect(volumeInput.value).toBe('0.4');
    expect(volumeInput.getAttribute('aria-valuetext')).toBe('40% (muted)');
    expect(root.querySelector('media-volume-range')!.hasAttribute('mediamuted')).toBe(true);
    mute.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.4);

    volumeInput.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, button: 0, bubbles: true, composed: true }));
    volumeInput.value = '0.8';
    volumeInput.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }));
    expect(video.volume).toBe(0.4);
    expect(volumeInput.value).toBe('0.8');
    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1 }));
    expect(video.volume).toBe(0.8);

    volumeInput.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 2, button: 0, bubbles: true, composed: true }));
    volumeInput.value = '0.2';
    volumeInput.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }));
    window.dispatchEvent(new window.PointerEvent('pointercancel', { pointerId: 2 }));
    expect(video.volume).toBe(0.8);
    expect(volumeInput.value).toBe('0.8');
    const wheel = new window.WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true });
    mute.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(video.volume).toBeCloseTo(0.75);
    mute.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }));
    expect(video.volume).toBeCloseTo(0.8);
    root.remove();
  });
}


test('leaving the viewport fades before pausing and preserves manual pause and replay volume', () => {
  const previousObserver = globalThis.IntersectionObserver;
  const previousFrame = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousPerformance = globalThis.performance;
  let now = 1000;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let notify: (entries: Array<{ isIntersecting: boolean }>) => void;
  let observing = false;
  Object.assign(globalThis, {
    IntersectionObserver: class {
      constructor(callback: typeof notify) { notify = callback; }
      observe() { observing = true; }
      disconnect() { observing = false; }
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  const controller = window.document.createElement('div');
  const video = window.document.createElement('video');
  let paused = true;
  let pauses = 0;
  Object.defineProperty(video, 'paused', { get: () => paused });
  video.pause = () => { paused = true; pauses += 1; video.dispatchEvent(new window.Event('pause')); };
  const play = () => { paused = false; video.dispatchEvent(new window.Event('play')); };
  const frame = (elapsed: number) => {
    now += elapsed;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(now));
  };
  controller.append(video);
  window.document.body.append(controller);
  try {
    video.volume = 0.8;
    bindVideoVisibility(video, controller, createPageScope());
    expect(observing).toBe(false);
    play();
    expect(observing).toBe(true);
    notify!([{ isIntersecting: true }]);
    expect(paused).toBe(false);
    notify!([{ isIntersecting: false }]);
    expect(paused).toBe(false);
    frame(150);
    expect(video.volume).toBeCloseTo(0.4);
    expect(paused).toBe(false);
    frame(150);
    expect(paused).toBe(true);
    expect(video.volume).toBeCloseTo(0.8);
    expect(observing).toBe(false);
    expect(frames.size).toBe(0);
    expect(pauses).toBe(1);
    notify!([{ isIntersecting: true }]);
    expect(paused).toBe(true);

    play();
    notify!([{ isIntersecting: false }]);
    frame(100);
    notify!([{ isIntersecting: true }]);
    expect(paused).toBe(false);
    expect(video.volume).toBeCloseTo(0.8);
    expect(frames.size).toBe(0);
    notify!([{ isIntersecting: false }]);
    frame(100);
    video.pause();
    expect(paused).toBe(true);
    expect(video.volume).toBeCloseTo(0.8);
    expect(frames.size).toBe(0);

    play();
    video.pause();
    expect(paused).toBe(true);
    expect(video.volume).toBeCloseTo(0.8);
    expect(frames.size).toBe(0);
    video.muted = true;
    play();
    notify!([{ isIntersecting: false }]);
    expect(paused).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.volume).toBeCloseTo(0.8);
    video.muted = false;
    video.volume = 0;
    play();
    notify!([{ isIntersecting: false }]);
    expect(paused).toBe(true);
    expect(video.volume).toBe(0);
    video.volume = 0.8;
    play();
    notify!([{ isIntersecting: false }]);
    controller.remove();
    frame(100);
    expect(paused).toBe(true);
    expect(video.volume).toBeCloseTo(0.8);
    expect(observing).toBe(false);
  } finally {
    controller.remove();
    Object.assign(globalThis, { IntersectionObserver: previousObserver, requestAnimationFrame: previousFrame, cancelAnimationFrame: previousCancel });
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: previousPerformance });
  }
});
