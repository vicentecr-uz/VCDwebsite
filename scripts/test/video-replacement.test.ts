import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { isAcceptedImageFile, isAcceptedVideoFile, isVideoSrc, isHeicUpload } from '../../src/lib/imageUpload.mjs';

const source = readFileSync(new URL('../../src/scripts/devVideoReplacement.ts', import.meta.url), 'utf8');
const transpile = (text: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(text.replaceAll('export function', 'function'));
const applyScript = transpile(source.slice(source.indexOf('export function applyMediaSource'), source.indexOf('let bound =')));
const bindScript = transpile(source.slice(source.indexOf('let bound =')));

function setup() {
  const window = new Window({ url: 'http://localhost:4322' });
  const document = window.document;
  document.documentElement.classList.add('is-dev-mode');
  document.body.innerHTML = '<figure class="project-media project-cropped project-media--placeholder" data-dev-image-target="image" data-dev-document="demo" data-dev-image-path="[&quot;sections&quot;,0]" data-dev-image-src="placeholder.svg" data-dev-image-src-width="1600" data-dev-image-src-height="1200"><div class="project-crop-clip"><img src="/images/placeholder.svg" alt="Demo"><span class="project-media__placeholder-label">Placeholder</span></div><button data-dev-edit-trigger="image">Edit image</button></figure>';
  const target = document.querySelector('figure')!;
  const queued = new Map<string, any>();
  const history: any[] = [];
  const alerts: string[] = [];
  const readers: { resolve: (dims: any) => void; reject: (error: Error) => void }[] = [];
  window.alert = (message: any) => { alerts.push(String(message)); };
  window.addEventListener('vcd:dev-pending-upsert', (event: any) => queued.set(event.detail.id, event.detail));
  window.addEventListener('vcd:dev-pending-remove', (event: any) => queued.delete(event.detail.id));
  const env: any = {
    window, document, HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement,
    HTMLVideoElement: window.HTMLVideoElement, CustomEvent: window.CustomEvent, AbortController,
    isAcceptedImageFile, isAcceptedVideoFile, isVideoSrc, isHeicUpload,
    projectImage: (src: string) => `/images/${src}`,
    createInlineVideo: (src: string, alt: string) => {
      const video = document.createElement('video');
      video.src = src; video.controls = true; video.playsInline = true; video.preload = 'metadata';
      video.setAttribute('data-project-inline-video', ''); video.setAttribute('aria-label', alt);
      return video;
    },
    cancelImagePreviewUpgrade: () => {}, refreshProjectCropCovers: () => {},
    syncImageSourceDims: (node: any, state: any) => {
      node.dataset.devImageSrcWidth = String(state.srcWidth);
      node.dataset.devImageSrcHeight = String(state.srcHeight);
    },
    syncPlaceholderState: (node: any, src: string) => {
      node.classList.toggle('project-media--placeholder', src === 'placeholder.svg');
      node.querySelector('.project-media__placeholder-label').hidden = src !== 'placeholder.svg';
    },
    withDevEditTarget: (payload: any) => ({ ...payload, target: { sectionId: 'stable' } }),
    devEditPendingId: () => 'crop:stable',
    pageHistory: { push: (command: any) => history.push(command) },
    readReplacementMedia: () => new Promise((resolve, reject) => readers.push({ resolve, reject })),
  };
  env.applyMediaSource = new Function('env', `with(env) { ${applyScript}; return applyMediaSource; }`)(env);
  new Function('env', `with(env) { ${bindScript}; bindVideoReplacement(); }`)(env);
  const replace = (src: string) => {
    const event = new window.CustomEvent('vcd:dev-image-replace', { cancelable: true, detail: { target, src } });
    window.dispatchEvent(event);
    return event;
  };
  const finish = async (index = readers.length - 1) => {
    readers[index].resolve({ srcWidth: 1920, srcHeight: 1080 });
    await Promise.resolve(); await Promise.resolve();
  };
  return { window, document, target, queued, history, readers, alerts, replace, finish, env };
}

test('video drop stages a playable replacement, preserving frame and reversible placeholder', async () => {
  const h = setup();
  expect(h.replace('demo.mp4').defaultPrevented).toBe(true);
  const saving = new h.window.CustomEvent('vcd:dev-before-save', { cancelable: true });
  h.window.dispatchEvent(saving);
  expect(saving.defaultPrevented).toBe(true);
  await h.finish();
  const video = h.target.querySelector('video')!;
  expect(video.controls).toBe(true);
  expect(video.playsInline).toBe(true);
  expect(h.target.classList.contains('project-cropped')).toBe(true);
  expect(h.queued.get('crop:stable').payload).toMatchObject({ src: 'demo.mp4', target: { sectionId: 'stable' }, srcWidth: 1920 });
  h.history[0].undo();
  expect(h.target.querySelector('img')).not.toBeNull();
  expect(h.target.dataset.devImageSrc).toBe('placeholder.svg');
  expect(h.queued.size).toBe(0);
  h.history[0].redo();
  expect(h.target.querySelector('video')).not.toBeNull();
  expect(h.queued.size).toBe(1);
});

test('undo after Save stages restoration, and discard restores the saved video', async () => {
  const h = setup(); h.replace('demo.mp4'); await h.finish();
  h.queued.clear();
  h.window.dispatchEvent(new h.window.CustomEvent('vcd:dev-pending-committed', { detail: { ids: ['crop:stable'] } }));
  h.history[0].undo();
  expect(h.queued.get('crop:stable').payload.src).toBe('placeholder.svg');
  h.queued.get('crop:stable').revert();
  expect(h.target.dataset.devImageSrc).toBe('demo.mp4');
});

test('video can be replaced by an image and both replacements undo in order', async () => {
  const h = setup(); h.replace('demo.mp4'); await h.finish();
  const video = h.target.querySelector('video')!;
  const controller = h.document.createElement('media-controller');
  controller.setAttribute('data-project-video-controller', '');
  video.replaceWith(controller);
  controller.append(video);
  controller.append(h.document.createElement('media-mute-button'));
  h.replace('still.png'); await h.finish();
  expect(h.target.querySelector('video')).toBeNull();
  expect(h.target.querySelector('media-controller')).toBeNull();
  expect(h.target.querySelector('img')?.getAttribute('src')).toBe('/images/still.png');
  h.history[1].undo();
  expect(h.target.dataset.devImageSrc).toBe('demo.mp4');
  h.history[0].undo();
  expect(h.target.dataset.devImageSrc).toBe('placeholder.svg');
});

test('stale media completion cannot overwrite a newer drop or a departed editor', async () => {
  const h = setup(); h.replace('first.mp4'); h.replace('second.webm');
  await h.finish(0);
  expect(h.target.dataset.devImageSrc).toBe('placeholder.svg');
  await h.finish(1);
  expect(h.target.dataset.devImageSrc).toBe('second.webm');
  h.replace('third.mp4');
  h.window.dispatchEvent(new h.window.CustomEvent('vcd:dev-mode-change', { detail: { active: false } }));
  await h.finish(2);
  expect(h.target.dataset.devImageSrc).toBe('second.webm');
});

test('failed metadata leaves the original media and pending crop intact', async () => {
  const h = setup();
  const prior = { id: 'crop:stable', kind: 'crop', payload: { variants: { desktop: { aspect: '4:3' } } }, revert: () => {} };
  h.window.dispatchEvent(new h.window.CustomEvent('vcd:dev-pending-upsert', { detail: prior }));
  h.replace('broken.mp4');
  h.readers[0].reject(new Error('Unreadable video'));
  await Promise.resolve(); await Promise.resolve();
  expect(h.target.dataset.devImageSrc).toBe('placeholder.svg');
  expect(h.queued.get('crop:stable')).toBe(prior);
  expect(h.alerts).toEqual(['Unreadable video']);
  expect(h.target.hasAttribute('aria-busy')).toBe(false);
});

test('replacement skips a fading crop ghost and discard also restores earlier crop edits', async () => {
  const h = setup();
  const ghost = h.document.createElement('div'); ghost.className = 'dev-crop-ghost';
  ghost.innerHTML = '<img src="/images/ghost.png">'; h.target.prepend(ghost);
  let reverted = false;
  h.window.dispatchEvent(new h.window.CustomEvent('vcd:dev-pending-upsert', { detail: {
    id: 'crop:stable', kind: 'crop', payload: { variants: { desktop: { aspect: '4:3' } } },
    revert: () => { reverted = true; expect(h.target.querySelector('.project-crop-clip > img')).not.toBeNull(); },
  } }));
  h.replace('demo.mp4'); await h.finish();
  expect(h.target.querySelector('.project-crop-clip > video')).not.toBeNull();
  expect(ghost.querySelector('img')).not.toBeNull();
  h.queued.get('crop:stable').revert();
  expect(reverted).toBe(true);
  expect(h.target.dataset.devImageSrc).toBe('placeholder.svg');
});
