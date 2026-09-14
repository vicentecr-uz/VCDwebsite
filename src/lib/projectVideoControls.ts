import 'media-chrome';
import type { MediaVolumeRange } from 'media-chrome';
import playIcon from 'lucide-static/icons/play.svg?raw';
import pauseIcon from 'lucide-static/icons/pause.svg?raw';
import volumeIcon from 'lucide-static/icons/volume-2.svg?raw';
import muteIcon from 'lucide-static/icons/volume-x.svg?raw';
import { sizeIcon } from './icons';

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
    if (video.volume > 0) previousVolume = video.volume;
    syncMutedVolume();
  });
  mute.addEventListener('mediaunmuterequest', (event) => {
    event.stopImmediatePropagation();
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
  const syncMutedVolume = bindVolumeControls(video, mute, volume);
  popup.append(volume);
  group.append(mute, popup);
  controller.append(play, progress, group);

  Promise.all(['media-controller', 'media-play-button', 'media-time-range', 'media-mute-button', 'media-volume-range']
    .map((name) => customElements.whenDefined(name))).then(() => {
    volume.shadowRoot?.querySelector('input')?.setAttribute('aria-orientation', 'vertical');
    video.removeAttribute('controls');
    syncMutedVolume();
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
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.isConnected) enhanceProjectVideos(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
