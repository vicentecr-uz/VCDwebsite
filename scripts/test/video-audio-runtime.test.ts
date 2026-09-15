import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost:4322' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLVideoElement', 'MutationObserver', 'customElements']) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: key === 'window' ? window : (window as any)[key],
  });
}
Object.assign(globalThis, {
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
});

const { syncProjectVideoAudio } = await import('../../src/lib/projectVideoControls');

function fixture(audio: string): HTMLVideoElement {
  const root = window.document.createElement('div');
  root.dataset.videoAudio = audio;
  const controller = window.document.createElement('div');
  controller.dataset.projectVideoController = '';
  const video = window.document.createElement('video');
  controller.append(video);
  root.append(controller);
  window.document.body.append(root);
  return video;
}

test('production data-video-audio=false hides controls and forces mute', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  const video = fixture('false');
  video.muted = false;
  syncProjectVideoAudio(video);
  expect(video.muted).toBe(true);
  expect(video.hasAttribute('data-project-video-audio-off')).toBe(true);
  expect(video.closest('[data-project-video-controller]')?.hasAttribute('data-project-video-audio-off')).toBe(true);
  video.closest('[data-video-audio]')!.remove();
});

test('production responsive audio metadata restores the visitor mute state when enabled', () => {
  const video = fixture('{"desktop":true,"mobile":false}');
  video.muted = false;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
  syncProjectVideoAudio(video);
  expect(video.muted).toBe(true);
  expect(video.hasAttribute('data-project-video-audio-off')).toBe(true);

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  syncProjectVideoAudio(video);
  expect(video.muted).toBe(false);
  expect(video.hasAttribute('data-project-video-audio-off')).toBe(false);
  video.closest('[data-video-audio]')!.remove();
});
