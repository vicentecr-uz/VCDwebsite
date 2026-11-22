import { projectVideoPoster } from './images';

export function createInlineVideo(src: string, alt = ''): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  const poster = projectVideoPoster(src);
  if (poster) video.poster = poster;
  video.className = 'project-inline-video';
  video.setAttribute('aria-label', alt || 'Video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'none';
  video.setAttribute('data-project-inline-video', '');
  return video;
}
