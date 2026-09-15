import { isAcceptedImageFile, isAcceptedVideoFile, isVideoSrc, isHeicUpload } from '../lib/imageUpload.mjs';
import { projectImage } from '../lib/images';
import { syncLightboxImage } from '../lib/imageLightbox';
import { createInlineVideo } from '../lib/inlineVideo';
import { syncImageSourceDims, syncPlaceholderState } from '../lib/projectImageFrame';
import { refreshProjectCropCovers } from '../lib/projectCropCover';
import { cancelImagePreviewUpgrade } from '../lib/imagePreviewUpgrade';
import { pageHistory } from '../lib/devHistory';
import { devEditPendingId, withDevEditTarget } from './devEditTarget';

type Source = { src: string; srcWidth: number; srcHeight: number; alt: string };
type Pending = { id: string; kind: string; payload: Record<string, unknown>; revert: () => void };

export function readReplacementMedia(src: string, video: boolean): Promise<{ srcWidth: number; srcHeight: number }> {
  return new Promise((resolve, reject) => {
    const media = video ? document.createElement('video') : new Image();
    const cleanup = () => {
      clearTimeout(timer);
      media.onload = media.onerror = null;
      if (media instanceof HTMLVideoElement) {
        media.onloadedmetadata = null;
        media.removeAttribute('src');
        media.load();
      }
    };
    const fail = () => { cleanup(); reject(new Error('This browser could not read that media. Try an MP4 with H.264 video or a WebM file.')); };
    const ready = () => {
      const srcWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
      const srcHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
      if (!srcWidth || !srcHeight) { fail(); return; }
      cleanup();
      resolve({ srcWidth, srcHeight });
    };
    const timer = setTimeout(fail, 15000);
    media.onerror = fail;
    if (media instanceof HTMLVideoElement) {
      media.preload = 'metadata';
      media.onloadedmetadata = ready;
    } else media.onload = ready;
    media.src = src;
  });
}

export function applyMediaSource(target: HTMLElement, state: Source) {
  const previous = [...target.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video[data-project-inline-video]')]
    .find((media) => !media.closest('.dev-crop-ghost') && !media.hasAttribute('data-preview-reveal'));
  if (!previous) return;
  if (previous instanceof HTMLImageElement) cancelImagePreviewUpgrade(previous);
  else previous.pause();
  const media = isVideoSrc(state.src) ? createInlineVideo(projectImage(state.src), state.alt) : document.createElement('img');
  media.src = projectImage(state.src);
  if (media instanceof HTMLImageElement) {
    media.alt = state.alt;
    syncLightboxImage(media, media.src);
    media.className = target.matches('.project-image-grid__item, .project-image-carousel__slide')
      ? 'project-image-grid__image' : 'project-media__img';
    if (target.classList.contains('project-media--max-vh') && !target.classList.contains('project-cropped')) {
      media.classList.add('project-media__img--max-vh');
    }
  }
  (previous.closest('[data-project-video-controller]') ?? previous).replaceWith(media);
  target.dataset.devImageSrc = state.src;
  syncImageSourceDims(target, state);
  syncPlaceholderState(target, state.src);
  window.dispatchEvent(new CustomEvent('vcd:dev-media-source-changed', { detail: { target, ...state } }));
  refreshProjectCropCovers(target.closest('.project-image-grid') ?? target);
  window.dispatchEvent(new CustomEvent('vcd:carousel-refresh', { detail: { block: target.closest('[data-project-image-carousel]') } }));
}

let bound = false;
export function bindVideoReplacement() {
  if (bound) return;
  bound = true;
  const pending = new Map<string, Pending>();
  const baselines = new Map<string, { state: Source; revert: () => void; pending?: Pending }>();
  const attempts = new Map<HTMLElement, AbortController>();
  let generation = 0;
  const snapshot = (target: HTMLElement): Source => ({
    src: target.dataset.devImageSrc || '',
    srcWidth: Number(target.dataset.devImageSrcWidth) || 0,
    srcHeight: Number(target.dataset.devImageSrcHeight) || 0,
    alt: target.querySelector('img')?.alt || target.querySelector('video')?.getAttribute('aria-label') || '',
  });
  window.addEventListener('vcd:dev-pending-upsert', ((event: CustomEvent<Pending>) => {
    if (event.detail?.kind === 'crop') pending.set(event.detail.id, event.detail);
  }) as EventListener);
  window.addEventListener('vcd:dev-pending-remove', ((event: CustomEvent<{ id: string }>) => {
    pending.delete(event.detail.id);
  }) as EventListener);
  window.addEventListener('vcd:dev-pending-committed', ((event: CustomEvent<{ ids: string[] }>) => {
    for (const id of event.detail.ids ?? []) { pending.delete(id); baselines.delete(id); }
  }) as EventListener);
  window.addEventListener('vcd:dev-pending-reverted', () => { pending.clear(); baselines.clear(); });
  const cancel = () => {
    generation++;
    attempts.forEach((controller, target) => { controller.abort(); target.removeAttribute('aria-busy'); });
    attempts.clear();
  };
  window.addEventListener('vcd:dev-edit-open', ((event: CustomEvent<{ panel?: HTMLElement }>) => {
    if (event.detail?.panel?.matches('[data-dev-panel-key="image"]')) cancel();
  }) as EventListener);
  document.addEventListener('astro:before-swap', () => { cancel(); pending.clear(); baselines.clear(); });
  window.addEventListener('vcd:dev-mode-change', ((event: CustomEvent<{ active: boolean }>) => {
    if (!event.detail.active) cancel();
  }) as EventListener);
  window.addEventListener('vcd:dev-before-save', (event) => {
    if (attempts.size) {
      event.preventDefault();
      window.alert('Wait for the media upload to finish before saving.');
    }
  });
  window.addEventListener('vcd:dev-image-replace', ((event: CustomEvent<{ target: HTMLElement; file?: File; src?: string }>) => {
    const { target, file, src } = event.detail ?? {};
    if (event.defaultPrevented || !document.documentElement.classList.contains('is-dev-mode')
      || !(target instanceof HTMLElement) || !target.matches('[data-dev-image-target]')
      || target.closest('.project-grid__item')) return;
    if (!isVideoSrc(file?.name ?? src) && !isVideoSrc(target.dataset.devImageSrc)) return;
    event.preventDefault();
    if (file && !isAcceptedImageFile(file) && !isAcceptedVideoFile(file)) {
      window.alert('Choose an image, MP4, WebM or M4V video.');
      return;
    }
    // V0 caps files at 37 MB for the JSON endpoint; larger uploads need a streaming endpoint.
    if (file && file.size > 37_000_000) {
      window.alert('Choose a video smaller than 37 MB.');
      return;
    }
    if (!file && !src) return;
    const flush = new CustomEvent('vcd:dev-before-save', { cancelable: true });
    // Supersede this target's older upload without blocking the new attempt.
    attempts.get(target)?.abort();
    attempts.delete(target);
    target.removeAttribute('aria-busy');
    window.dispatchEvent(flush);
    if (flush.defaultPrevented) return;
    document.querySelectorAll<HTMLElement>('[data-dev-panel-key="image"]').forEach((panel) => {
      if (!panel.hidden) {
        panel.hidden = true;
        window.dispatchEvent(new CustomEvent('vcd:dev-edit-close', { detail: { panel } }));
      }
    });
    const before = snapshot(target);
    const controller = new AbortController();
    attempts.set(target, controller);
    target.setAttribute('aria-busy', 'true');
    const started = generation;
    const identity = withDevEditTarget({ document: target.dataset.devDocument, path: JSON.parse(target.dataset.devImagePath || '[]') }, target);
    const id = devEditPendingId('crop', target);
    const current = () => !controller.signal.aborted && generation === started && target.isConnected
      && attempts.get(target) === controller && target.dataset.devImageSrc === before.src;
    void (async () => {
      let objectUrl: string | undefined;
      try {
        objectUrl = file ? URL.createObjectURL(file) : undefined;
        const convertedImage = file && isHeicUpload(file.name, file.type);
        let dims = convertedImage ? null : await readReplacementMedia(objectUrl ?? projectImage(src!), isVideoSrc(file?.name ?? src));
        if (!current()) return;
        let nextSrc = src!;
        if (file) {
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
            reader.onerror = () => reject(new Error('Could not read that file.'));
            reader.readAsDataURL(file);
          });
          const response = await fetch('/api/upload', {
            method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ document: identity.document, files: [{ filename: file.name, mimeType: file.type, data }] }),
          });
          const result = await response.json();
          if (!response.ok || !result.filenames?.[0]) throw new Error(result.error || 'Could not upload that file.');
          nextSrc = result.filenames[0];
        }
        if (!current()) return;
        if (!dims) dims = await readReplacementMedia(projectImage(nextSrc), false);
        if (!current()) return;
        const after = { ...before, src: nextSrc, ...dims };
        const prior = pending.get(id);
        if (!baselines.has(id)) baselines.set(id, { state: before, revert: () => { applyMediaSource(target, before); prior?.revert(); }, pending: prior });
        const stage = (state: Source) => {
          if (!target.isConnected) return;
          if (!baselines.has(id)) {
            const saved = snapshot(target);
            baselines.set(id, { state: saved, revert: () => applyMediaSource(target, saved) });
          }
          applyMediaSource(target, state);
          const baseline = baselines.get(id)!;
          if (state.src === baseline.state.src) {
            window.dispatchEvent(new CustomEvent(baseline.pending ? 'vcd:dev-pending-upsert' : 'vcd:dev-pending-remove', {
              detail: baseline.pending ?? { id },
            }));
            return;
          }
          const payload = { ...baseline.pending?.payload, ...identity, src: state.src, srcWidth: state.srcWidth, srcHeight: state.srcHeight };
          window.dispatchEvent(new CustomEvent('vcd:dev-pending-upsert', { detail: {
            id, kind: 'crop', payload, revert: baseline.revert,
          } }));
        };
        stage(after);
        pageHistory.push({ label: 'Replace media', undo: () => stage(before), redo: () => stage(after) });
      } catch (error) {
        if (current()) window.alert(error instanceof Error ? error.message : 'Could not replace that media.');
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (attempts.get(target) === controller) { attempts.delete(target); target.removeAttribute('aria-busy'); }
      }
    })();
  }) as EventListener, { capture: true });
}
