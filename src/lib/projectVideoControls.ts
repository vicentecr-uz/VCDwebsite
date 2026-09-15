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
  const target = video.closest<HTMLElement>('[data-dev-image-target]');
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

function bindVolumeControls(video: HTMLVideoElement, mute: HTMLElement, volume: MediaVolumeRange): () => void {
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
  new MutationObserver(syncMutedVolume).observe(volume, {
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

function bindVideoVisibility(video: HTMLVideoElement, controller: HTMLElement): void {
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
  if (!video.paused) observer.observe(controller);
}

export function enhanceProjectVideo(video: HTMLVideoElement): void {
  if (!video.matches('video[data-project-inline-video]') || !video.parentElement) return;
  let controller = video.closest<HTMLElement>('media-controller');
  if (controller?.hasAttribute('data-project-video-controller')) return;
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
  const syncMutedVolume = bindVolumeControls(video, mute, volume);
  popup.append(volume);
  group.append(mute, popup);
  controller.append(play, progress, group);
  syncProjectVideoAudio(video);
  bindVideoVisibility(video, controller);

  Promise.all(['media-controller', 'media-play-button', 'media-time-range', 'media-mute-button', 'media-volume-range']
    .map((name) => customElements.whenDefined(name))).then(() => {
    volume.shadowRoot?.querySelector('input')?.setAttribute('aria-orientation', 'vertical');
    video.removeAttribute('controls');
    syncMutedVolume();
    syncBuffered();
    if (video.dataset.autoplay === 'true' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.play().catch(() => {});
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
        if (node instanceof HTMLVideoElement && !node.isConnected) node.pause();
        else if (node instanceof Element) node.querySelectorAll<HTMLVideoElement>('video[data-project-inline-video]').forEach((video) => {
          if (!video.isConnected) video.pause();
        });
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
