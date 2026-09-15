import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCropChange } from '../../astro.config.mjs';
import { resolveVideoAudio, videoAudioForViewport, videoAudioStyle } from '../../src/lib/videoAudio.ts';

test('audio settings inherit across desktop, tablet and mobile by default', () => {
  assert.deepEqual(resolveVideoAudio(undefined), { desktop: true, tablet: true, mobile: true });
  assert.deepEqual(resolveVideoAudio(false), { desktop: false, tablet: false, mobile: false });
  assert.deepEqual(resolveVideoAudio({ desktop: false }), { desktop: false, tablet: false, mobile: false });
  assert.deepEqual(resolveVideoAudio({ tablet: false }), { desktop: true, tablet: false, mobile: false });
  assert.deepEqual(resolveVideoAudio({ mobile: true }), { desktop: true, tablet: true, mobile: true });
  assert.equal(videoAudioForViewport(resolveVideoAudio({ desktop: false }), 'mobile'), false);
  assert.equal(videoAudioStyle(resolveVideoAudio({ desktop: false })), '--project-video-audio-desktop:0;--project-video-audio-tablet:0;--project-video-audio-mobile:0');
});

test('audio off persists and switching back to true clears the override', () => {
  const data = { sections: [{ type: 'image', id: 'clip', src: 'clip.mp4', variants: { desktop: { aspect: 'original' } } }] };
  assert.deepEqual(applyCropChange(data, { path: ['sections', 0], audio: false }), { ok: true });
  assert.equal(data.sections[0].audio, false);
  assert.deepEqual(applyCropChange(data, { path: ['sections', 0], audio: true }), { ok: true });
  assert.equal(Object.hasOwn(data.sections[0], 'audio'), false);
});

test('sparse audio settings retain source and crop changes', () => {
  const data = { sections: [{ type: 'image', id: 'clip', src: 'old.mp4', srcWidth: 640, srcHeight: 360, variants: { desktop: { aspect: '16:9' } } }] };
  assert.deepEqual(applyCropChange(data, {
    path: ['sections', 0],
    src: 'new.mp4',
    srcWidth: 1280,
    srcHeight: 720,
    variants: { desktop: { aspect: 'original', cx: .4, cy: .6, w: .8 } },
    audio: { mobile: false },
  }), { ok: true });
  assert.equal(data.sections[0].src, 'new.mp4');
  assert.equal(data.sections[0].srcWidth, 1280);
  assert.equal(data.sections[0].srcHeight, 720);
  assert.deepEqual(data.sections[0].variants, { desktop: { aspect: 'original', cx: .4, cy: .6, w: .8 } });
  assert.deepEqual(data.sections[0].audio, { mobile: false });
});

test('invalid audio is rejected without mutating the section', () => {
  const data = { sections: [{ type: 'image', id: 'clip', src: 'clip.mp4', audio: { desktop: false } }] };
  const before = structuredClone(data);
  const result = applyCropChange(data, { path: ['sections', 0], audio: { phone: false } });
  assert.deepEqual(result, { ok: false, error: 'Video audio settings are invalid.' });
  assert.deepEqual(data, before);
});
