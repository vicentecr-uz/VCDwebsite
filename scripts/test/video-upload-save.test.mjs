import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import test from 'node:test';
import {
  applyCropChangeFromSource,
} from '../../astro.config.mjs';
import { isAcceptedVideoFile, isVideoSrc } from '../../src/lib/imageUpload.mjs';

const execFile = promisify(execFileCallback);

test('accepts supported video extensions with matching or empty MIME types', () => {
  assert.equal(isAcceptedVideoFile({ name: 'clip.mp4', type: 'video/mp4' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'clip.webm', type: '' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'clip.m4v', type: 'video/x-m4v' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'clip.mp4', type: 'image/jpeg' }), false);
  assert.equal(isAcceptedVideoFile({ name: 'clip.mov', type: 'video/quicktime' }), false);
  assert.equal(isVideoSrc('/images/clip.mp4?cache=1'), true);
  assert.equal(isVideoSrc('clip.jpg'), false);
});

test('saves trusted video dimensions and rejects malformed or disallowed video sources', async () => {
  const directory = await mkdtemp(path.join(process.cwd(), 'media', 'video-save-test-'));
  const src = `${path.basename(directory)}/clip.mp4`;
  try {
    await execFile('/opt/homebrew/bin/ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=48x32:d=0.1',
      '-frames:v', '1', '-pix_fmt', 'yuv420p', path.join(directory, 'clip.mp4'),
    ]);
    const data = { sections: [{ type: 'image', src: 'placeholder.svg' }] };
    assert.deepEqual(await applyCropChangeFromSource(data, {
      path: ['sections', 0], src, variants: { desktop: { aspect: 'original', cx: 0.5, cy: 0.5, w: 1 } },
    }), { ok: true });
    assert.equal(data.sections[0].srcWidth, 48);
    assert.equal(data.sections[0].srcHeight, 32);

    const malformed = `${path.basename(directory)}/broken.webm`;
    await writeFile(path.join(directory, 'broken.webm'), 'not a video');
    const invalid = await applyCropChangeFromSource({ sections: [{ type: 'image', src }] }, {
      path: ['sections', 0], src: malformed,
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /video|ffprobe/i);

    const listing = await applyCropChangeFromSource({ listings: { home: { image: 'placeholder.svg' } } }, {
      path: ['listings', 'home'], src,
    });
    assert.deepEqual(listing, { ok: false, error: 'Videos can only be placed in image blocks.' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('restores placeholder dimensions after replacing a placeholder with video', async () => {
  const data = { sections: [{ type: 'image', src: 'clip.mp4', srcWidth: 48, srcHeight: 32 }] };
  assert.deepEqual(await applyCropChangeFromSource(data, {
    path: ['sections', 0], src: 'placeholder.svg',
  }), { ok: true });
  assert.equal(data.sections[0].src, 'placeholder.svg');
  assert.equal(data.sections[0].srcWidth, 1600);
  assert.equal(data.sections[0].srcHeight, 1200);
});
