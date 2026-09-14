import { projectVideoPoster } from './images';

/** Create the shared inline video element used by live dev mounts. */
export function createInlineVideo(src: string, alt = ''): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  const poster = projectVideoPoster(src);
  if (poster) video.poster = poster;
  video.className = 'project-inline-video';
  video.setAttribute('aria-label', alt || 'Video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.setAttribute('data-project-inline-video', '');
  return video;
}
