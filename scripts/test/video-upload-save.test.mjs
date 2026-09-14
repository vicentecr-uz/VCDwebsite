import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import test from 'node:test';
import {
  applyCropChangeFromSource, applyCropChange,
} from '../../astro.config.mjs';
import { fillPlaceholderImageSection } from '../../scripts/dev-api-plugins.mjs';
import { isAcceptedVideoFile, isVideoSrc } from '../../src/lib/imageUpload.mjs';
import { mediaDevServer } from '../../scripts/dev-api-plugins.mjs';

const execFile = promisify(execFileCallback);
const ffmpeg = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';

test('accepts supported video extensions with matching or empty MIME types', () => {
  assert.equal(isAcceptedVideoFile({ name: 'clip.mp4', type: 'video/mp4' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'clip.webm', type: '' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'clip.m4v', type: 'video/x-m4v' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'clip.mp4', type: 'image/jpeg' }), false);
  assert.equal(isAcceptedVideoFile({ name: 'clip.mov', type: 'video/quicktime' }), false);
  assert.equal(isVideoSrc('/images/clip.mp4?cache=1'), true);
  assert.equal(isVideoSrc('clip.jpg'), false);
});

test('saves trusted video dimensions and rejects malformed or disallowed video sources', async (t) => {
  try { await execFile(ffmpeg, ['-version']); } catch (error) {
    if (error.code === 'ENOENT') { t.skip('ffmpeg is needed to generate the video fixture'); return; }
    throw error;
  }
  const directory = await mkdtemp(path.join(process.cwd(), 'media', 'video-save-test-'));
  const src = `${path.basename(directory)}/clip.mp4`;
  try {
    await execFile(ffmpeg, [
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
    await assert.rejects(
      fillPlaceholderImageSection({ type: 'image', src: 'placeholder.svg' }, '', 'broken.webm'),
      /Could not read that video file/,
    );

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

test('serves video ranges, suffix ranges, open ranges and HEAD without buffering the whole file', async () => {
  const directory = await mkdtemp(path.join(process.cwd(), 'media', 'video-range-test-'));
  const filename = 'range.mp4';
  const payload = Buffer.from('0123456789');
  let middleware;
  mediaDevServer().configureServer({ middlewares: { use(_path, handler) { middleware = handler; } } });
  await writeFile(path.join(directory, filename), payload);
  const server = http.createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((resolve) => server.listen(0, resolve));
  const request = (method, range) => new Promise((resolve, reject) => {
    const req = http.request({ port: server.address().port, path: `/${path.basename(directory)}/${filename}`, method, headers: range ? { range } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    assert.equal((await request('GET')).status, 200);
    assert.equal((await request('GET')).body.toString(), '0123456789');
    const suffix = await request('GET', 'bytes=-3');
    assert.equal(suffix.status, 206);
    assert.equal(suffix.body.toString(), '789');
    assert.equal((await request('GET', 'bytes=4-')).body.toString(), '456789');
    assert.equal((await request('GET', 'bytes=2-5')).body.toString(), '2345');
    const invalid = await request('GET', 'bytes=99-100');
    assert.equal(invalid.status, 416);
    const head = await request('HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-length'], '10');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});


test('video validation follows stable sections after reorder and rejects nested non-media paths', () => {
  const data = { sections: [{ type: 'bodyText', id: 'text' }, { type: 'image', id: 'media', src: 'placeholder.svg', extra: {} }] };
  assert.deepEqual(applyCropChange(data, { path: ['sections', 0], target: { sectionId: 'media' }, src: 'clip.mp4' }), { ok: true });
  assert.equal(data.sections[1].src, 'clip.mp4');
  assert.equal(applyCropChange(data, { path: ['sections', 1, 'extra'], src: 'clip.mp4' }).ok, false);
});
