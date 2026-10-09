import { createPageScope } from './pageLifecycle';
const videoScopes = new WeakMap<HTMLVideoElement, ReturnType<typeof createPageScope>>();
import 'media-chrome';
import type { MediaVolumeRange } from 'media-chrome';
import playIcon from 'lucide-static/icons/play.svg?raw';
import pauseIcon from 'lucide-static/icons/pause.svg?raw';
import volumeIcon from 'lucide-static/icons/volume-2.svg?raw';
import muteIcon from 'lucide-static/icons/volume-x.svg?raw';
import { sizeIcon } from './icons';
import { resolveVideoAudio, type ResolvedVideoAudio } from './videoAudio';

const viewportForVideo = () => window.innerWidth <= 767 ? 'mobile' : window.innerWidth <= 991 ? 'tablet' : 'desktop';

function readVideoAudio(video: HTMLVideoElement): ResolvedVideoAudio {
  const target = video.closest<HTMLElement>('[data-dev-image-target], [data-video-audio]');
  try {
    const raw = target?.dataset.devVideoAudio || target?.dataset.videoAudio;
    return resolveVideoAudio(raw ? JSON.parse(raw) : undefined);
  } catch {
    return resolveVideoAudio(undefined);
  }
}

const forcedMuteBeforeAuthoredOff = new WeakMap<HTMLVideoElement, boolean>();

export function syncProjectVideoAudio(video: HTMLVideoElement): void {
  const controller = video.closest<HTMLElement>('[data-project-video-controller]');
  const authoredOn = readVideoAudio(video)[viewportForVideo()];
  video.toggleAttribute('data-project-video-audio-off', !authoredOn);
  if (!authoredOn) {
    if (!forcedMuteBeforeAuthoredOff.has(video)) forcedMuteBeforeAuthoredOff.set(video, video.muted);
    video.muted = true;
  } else if (forcedMuteBeforeAuthoredOff.has(video)) {
    video.muted = forcedMuteBeforeAuthoredOff.get(video) ?? false;
    forcedMuteBeforeAuthoredOff.delete(video);
  }
  controller?.toggleAttribute('data-project-video-audio-off', !authoredOn);
}

const icon = (source: string, slot: string, size = 28) =>
  sizeIcon(source, size).replace('<svg', `<svg slot="${slot}"`);

function bindVolumeControls(video: HTMLVideoElement, mute: HTMLElement, volume: MediaVolumeRange, scope: ReturnType<typeof createPageScope>): () => void {
  let previousVolume = 0.5;
  let drag: { pointerId: number; value: number | null; listeners: AbortController } | undefined;
  const syncMutedVolume = () => queueMicrotask(() => {
    if (!video.muted || drag) return;
    const input = volume.shadowRoot?.querySelector('input');
    if (!input) return;
    input.value = String(video.volume);
    input.setAttribute('aria-valuetext', `${Math.round(video.volume * 100)}% (muted)`);
    volume.updateBar();
  });
  const apply = (value: number) => {
    video.volume = Math.max(0, Math.min(1, value));
    if (video.volume > 0) {
      previousVolume = video.volume;
      video.muted = false;
    }
  };
  video.addEventListener('volumechange', () => {
    if (video.volume > 0 && !video.hasAttribute('data-project-video-fading')) previousVolume = video.volume;
  });
  const observer = new MutationObserver(syncMutedVolume);
  scope.add(() => { observer.disconnect(); drag?.listeners.abort(); });
  observer.observe(volume, {
    attributes: true, attributeFilter: ['mediamuted', 'mediavolume'],
  });
  mute.addEventListener('mediaunmuterequest', (event) => {
    event.stopImmediatePropagation();
    if (video.hasAttribute('data-project-video-audio-off')) return;
    if (video.volume === 0) video.volume = previousVolume;
    video.muted = false;
  });
  mute.addEventListener('wheel', (event) => {
    if (!event.deltaY) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1);
    const step = Math.max(-0.05, Math.min(0.05, pixels / 1000));
    apply(video.volume + step);
  }, { passive: false });
  volume.addEventListener('mediavolumerequest', (event) => {
    if (!drag) return;
    event.stopImmediatePropagation();
    drag.value = Number((event as CustomEvent).detail);
  });
  volume.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    drag = { pointerId: event.pointerId, value: null, listeners: new AbortController() };
    volume.setAttribute('data-volume-dragging', '');
    const finish = (end: PointerEvent) => {
      if (!drag || end.pointerId !== drag.pointerId) return;
      const value = drag.value;
      if (end.type === 'pointerup' && value !== null && video.isConnected) apply(value);
      else {
        const input = volume.shadowRoot?.querySelector('input');
        if (input) {
          input.value = String(video.volume);
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
      }
      drag.listeners.abort();
      drag = undefined;
      volume.removeAttribute('data-volume-dragging');
    };
    window.addEventListener('pointerup', finish, { capture: true, signal: drag.listeners.signal });
    window.addEventListener('pointercancel', finish, { capture: true, signal: drag.listeners.signal });
  }, { capture: true });
  return syncMutedVolume;
}

function bindVideoVisibility(video: HTMLVideoElement, controller: HTMLElement, scope: ReturnType<typeof createPageScope>): void {
  if (typeof IntersectionObserver === 'undefined' || video.dataset.videoVisibilityBound === 'true') return;
  video.dataset.videoVisibilityBound = 'true';
  let fade: { volume: number; start: number; frame: number } | undefined;
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) cancelFade();
    else if (!video.paused) startFade();
  }, { threshold: 0 });
  const cancelFade = () => {
    if (fade) cancelAnimationFrame(fade.frame);
    if (fade) video.volume = fade.volume;
    fade = undefined;
    video.removeAttribute('data-project-video-fading');
  };
  const startFade = () => {
    if (fade || video.paused) return;
    const volume = video.volume;
    if (video.muted || volume <= 0) { video.pause(); return; }
    fade = { volume, start: performance.now(), frame: 0 };
    video.setAttribute('data-project-video-fading', '');
    const tick = (now: number) => {
      if (!fade || video.paused) { cancelFade(); return; }
      if (!video.isConnected) {
        video.pause();
        cancelFade();
        return;
      }
      const progress = Math.max(0, Math.min(1, (now - fade.start) / 300));
      video.volume = fade.volume * (1 - progress);
      if (progress >= 1) { video.pause(); cancelFade(); return; }
      fade.frame = requestAnimationFrame(tick);
    };
    fade.frame = requestAnimationFrame(tick);
  };
  video.addEventListener('play', () => { observer.observe(controller); });
  const stop = () => { observer.disconnect(); cancelFade(); };
  video.addEventListener('pause', stop);
  video.addEventListener('ended', stop);
  scope.add(stop);
  if (!video.paused) observer.observe(controller);
}

function bindVideoPoster(video: HTMLVideoElement, controller: HTMLElement, scope: ReturnType<typeof createPageScope>): (() => void) | null {
  if (!video.poster) return null;

  const poster = document.createElement('img');
  poster.className = 'project-video-player__poster';
  poster.src = video.poster;
  poster.alt = '';
  poster.setAttribute('aria-hidden', 'true');
  poster.setAttribute('noautohide', '');
  poster.style.pointerEvents = 'none';
  controller.insertBefore(poster, video);

  let generation = 0;
  let pending = false;
  let primed = false;
  let gateActive = true;
  let animation: Animation | null = null;
  let frame1 = 0;
  let frame2 = 0;
  let resetting = false;

  const restore = (stopLoading = true) => {
    generation++;
    pending = false;
    primed = false;
    gateActive = true;
    animation?.cancel();
    animation = null;
    if (frame1) cancelAnimationFrame(frame1);
    if (frame2) cancelAnimationFrame(frame2);
    frame1 = 0; frame2 = 0;
    poster.hidden = false;
    poster.style.opacity = '1';
    video.pause();
    if (stopLoading) {
      video.preload = 'none';
      if (!resetting) {
        resetting = true;
        try { video.load(); } catch { /* media may be detached during teardown */ }
        resetting = false;
      }
    }
  };

  const finish = (token: number) => {
    if (!pending || token !== generation || !video.isConnected || video.readyState < 3 || video.videoWidth <= 0) return;
    pending = false;
    animation = poster.animate(
      [{ opacity: '1' }, { opacity: '0' }],
      { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200, easing: 'ease-out', fill: 'forwards' },
    );
    void animation.finished.then(() => {
      if (token !== generation) return;
      poster.hidden = true;
      const fade = animation;
      animation = null;
      fade?.cancel();
      const result = video.play();
      void Promise.resolve(result).then(() => {
        if (token !== generation) return;
        gateActive = false;
        primed = false;
      }).catch(() => {
        if (token !== generation) return;
        gateActive = true;
        restore();
      });
    }).catch(() => {
      if (token === generation) restore();
    });
  };

  const ready = () => {
    if (!pending || frame1 || frame2 || video.readyState < 3 || video.videoWidth <= 0) return;
    const token = generation;
    frame1 = scope.frame(() => {
      frame1 = 0;
      frame2 = scope.frame(() => { frame2 = 0; finish(token); });
    });
  };

  const start = () => {
    if (!gateActive) return;
    if (!pending && !primed) {
      pending = true;
      primed = true;
      generation++;
      const token = generation;
      video.preload = 'auto';
      // Synchronous play/pause preserves the user gesture for delayed playback.
      let result: Promise<void> | undefined;
      try { result = video.play(); } catch { restore(); return; }
      video.pause();
      void Promise.resolve(result).catch((error: unknown) => {
        if (token === generation && (error as DOMException)?.name !== 'AbortError') restore();
      });
      ready();
      return;
    }
    restore();
    primed = false;
  };

  scope.listen(video, 'canplay', ready);
  scope.listen(video, 'loadeddata', ready);
  scope.listen(controller, 'mediaplayrequest', (event) => {
    if (!gateActive) return;
    event.stopImmediatePropagation();
    start();
  }, true);
  scope.listen(controller, 'mediapauserequest', (event) => {
    if (!pending && !animation) return;
    event.stopImmediatePropagation();
    restore();
    primed = false;
  }, true);
  scope.listen(video, 'emptied', () => {
    if (resetting) return;
    poster.src = video.poster;
    gateActive = true;
    primed = false;
    restore(false);
  });
  scope.listen(video, 'error', () => {
    if (!gateActive) return;
    video.preload = 'none';
    restore(false);
  });
  scope.add(() => {
    restore(false);
    poster.remove();
  });
  return start;
}

export function enhanceProjectVideo(video: HTMLVideoElement): void {
  if (!video.matches('video[data-project-inline-video]') || !video.parentElement) return;
  let controller = video.closest<HTMLElement>('media-controller');
  if (controller?.hasAttribute('data-project-video-controller')) return;
  const scope = createPageScope();
  videoScopes.set(video, scope);
  scope.add(() => video.pause());
  if (!controller) {
    controller = document.createElement('media-controller');
    controller.setAttribute('novolumepref', '');
    controller.setAttribute('nomutedpref', '');
    video.replaceWith(controller);
    controller.append(video);
  }
  controller.classList.add('project-video-player__controller');
  controller.setAttribute('data-project-video-controller', '');
  controller.setAttribute('novolumepref', '');
  video.volume = 0.5;
  controller.setAttribute('keyboardforwardseekoffset', '5');
  controller.setAttribute('keyboardbackwardseekoffset', '5');
  video.slot = 'media';
  const startPosterPlayback = bindVideoPoster(video, controller, scope);

  const play = document.createElement('media-play-button');
  play.className = 'project-video-player__play';
  play.setAttribute('noautohide', '');
  play.innerHTML = `${icon(playIcon, 'play')}${icon(pauseIcon, 'pause')}`.replaceAll('fill="none"', 'fill="currentColor"');

  const progress = document.createElement('media-time-range');
  progress.className = 'project-video-player__progress';
  progress.setAttribute('noautohide', '');
  const syncBuffered = () => {
    const ranges = video.buffered;
    const duration = video.duration;
    const rects = Number.isFinite(duration) && duration > 0
      ? Array.from({ length: ranges.length }, (_, index) => {
          const start = Math.max(0, Math.min(duration, ranges.start(index))) / duration * 100;
          const end = Math.max(0, Math.min(duration, ranges.end(index))) / duration * 100;
          return end > start
            ? `<rect x="${start}%" width="${end - start}%" height="100%" rx="3" fill="white"/>`
            : '';
        }).filter(Boolean)
      : [];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${rects.join('')}</svg>`;
    const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    if (progress.style.getPropertyValue('--project-video-buffered-ranges') !== mask) {
      progress.style.setProperty('--project-video-buffered-ranges', mask);
    }
  };
  // Show all buffered sections, including those away from the playhead.
  ['progress', 'loadeddata', 'durationchange', 'timeupdate', 'seeked', 'emptied']
    .forEach((eventName) => video.addEventListener(eventName, syncBuffered));

  const group = document.createElement('div');
  group.className = 'project-video-player__volume-group';
  group.setAttribute('noautohide', '');
  const mute = document.createElement('media-mute-button');
  mute.className = 'project-video-player__mute';
  mute.innerHTML = `${icon(muteIcon, 'off', 18)}${['low', 'medium', 'high'].map((slot) => icon(volumeIcon, slot, 18)).join('')}`;
  const popup = document.createElement('div');
  popup.className = 'project-video-player__volume-popup';
  const volume = document.createElement('media-volume-range') as MediaVolumeRange;
  volume.className = 'project-video-player__volume';
  [progress, volume].forEach((control) => {
    const syncKeyboardFocus = (event: FocusEvent) => {
      const target = event.composedPath()[0];
      control.toggleAttribute('data-video-keyboard-focus', target instanceof Element && target.matches(':focus-visible'));
    };
    // Shadow range inputs cannot expose :focus-visible to selectors outside their host.
    control.addEventListener('focusin', syncKeyboardFocus);
    control.addEventListener('focusout', () => control.removeAttribute('data-video-keyboard-focus'));
    control.addEventListener('pointerdown', () => control.removeAttribute('data-video-keyboard-focus'), { capture: true });
    control.addEventListener('keydown', () => control.setAttribute('data-video-keyboard-focus', ''));
  });
  const syncMutedVolume = bindVolumeControls(video, mute, volume, scope);
  popup.append(volume);
  group.append(mute, popup);
  controller.append(play, progress, group);
  syncProjectVideoAudio(video);
  bindVideoVisibility(video, controller, scope);

  Promise.all(['media-controller', 'media-play-button', 'media-time-range', 'media-mute-button', 'media-volume-range']
    .map((name) => customElements.whenDefined(name))).then(() => {
    if (scope.signal.aborted || !video.isConnected) return;
    volume.shadowRoot?.querySelector('input')?.setAttribute('aria-orientation', 'vertical');
    video.removeAttribute('controls');
    syncMutedVolume();
    syncBuffered();
    if (video.dataset.autoplay === 'true' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (startPosterPlayback) startPosterPlayback();
      else video.play().catch(() => {});
    }
  });
}

export function enhanceProjectVideos(root: ParentNode = document): void {
  if (root instanceof HTMLVideoElement) enhanceProjectVideo(root);
  else root.querySelectorAll<HTMLVideoElement>('video[data-project-inline-video]').forEach(enhanceProjectVideo);
}

let bound = false;
export function bindProjectVideoControls(): void {
  if (bound) return;
  bound = true;
  const boot = () => enhanceProjectVideos();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  document.addEventListener('astro:page-load', boot);
  document.addEventListener('astro:before-swap', () => {
    document.querySelectorAll<HTMLVideoElement>('video[data-project-inline-video]').forEach((video) => videoScopes.get(video)?.destroy());
  });
  window.addEventListener('resize', () => {
    document.querySelectorAll<HTMLVideoElement>('video[data-project-inline-video]').forEach(syncProjectVideoAudio);
  }, { passive: true });
  new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof HTMLElement ? record.target : null;
      target?.querySelectorAll<HTMLVideoElement>('video[data-project-inline-video]').forEach(syncProjectVideoAudio);
      if (target?.matches('video[data-project-inline-video]')) syncProjectVideoAudio(target as HTMLVideoElement);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-video-audio', 'data-dev-video-audio'] , subtree: true });
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.isConnected) enhanceProjectVideos(node);
      }
      for (const node of record.removedNodes) {
        if (node instanceof HTMLVideoElement && !node.isConnected) { node.pause(); videoScopes.get(node)?.destroy(); }
        else if (node instanceof Element) node.querySelectorAll<HTMLVideoElement>('video[data-project-inline-video]').forEach((video) => {
          if (!video.isConnected) { video.pause(); videoScopes.get(video)?.destroy(); }
        });
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
