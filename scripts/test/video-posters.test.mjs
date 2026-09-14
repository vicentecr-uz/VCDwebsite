// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import { collectShippedAssets } from '../collect-shipped-assets.mjs';
import { generatePosterBuffer, findOriginal, isDerivativeToken, originalCandidates } from '../image-derivatives.mjs';
import { projectVideoPoster } from '../../src/lib/images.ts';

const execFileAsync = promisify(execFile);

test('generates and collects a bounded video poster without image-stem collisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-video-poster-'));
  const media = path.join(root, 'media');
  const dist = path.join(root, 'dist');
  await mkdir(media, { recursive: true });
  await mkdir(dist, { recursive: true });
  try {
    const videoPath = path.join(media, 'clip.mp4');
    await execFileAsync(ffmpeg.path, [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x10:d=0.2',
      '-frames:v', '1', '-y', videoPath,
    ]);
    await sharp({ create: { width: 16, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .jpeg().toFile(path.join(media, 'clip.jpg'));
    await writeFile(path.join(media, 'photo.poster.webp'), 'existing image poster');

    const poster = await generatePosterBuffer(videoPath);
    const metadata = await sharp(poster).metadata();
    assert.deepEqual(
      { width: metadata.width, height: metadata.height, format: metadata.format },
      { width: 16, height: 10, format: 'webp' },
    );
    const { channels } = await sharp(poster).stats();
    assert.ok(channels[0].mean > 200 && channels[2].mean < 30, 'poster shows the red video frame, not the blue image');
    assert.deepEqual(originalCandidates('clip.mp4.poster.webp'), ['clip.mp4']);
    assert.equal(await findOriginal(media, 'clip.mp4.poster.webp'), videoPath);
    assert.equal(isDerivativeToken('photo.poster.webp'), false);
    assert.equal(projectVideoPoster('clip.mp4'), '/images/clip.mp4.poster.webp');
    assert.equal(projectVideoPoster('folder/clip name.mp4?cache=1'), '/images/folder/clip%20name.mp4.poster.webp?cache=1');
    assert.equal(projectVideoPoster('/images/clip.mp4?cache=1'), '/images/clip.mp4.poster.webp?cache=1');
    assert.equal(projectVideoPoster('https://cdn.example/clip.mp4'), undefined);

    await writeFile(path.join(dist, 'index.html'), '<video poster="/images/clip.mp4.poster.webp"></video>');
    const result = await collectShippedAssets(dist, media);
    const shippedPoster = await readFile(path.join(dist, 'images', 'clip.mp4.poster.webp'));
    assert.equal(result.copied, 1);
    assert.ok((await stat(path.join(dist, 'images', 'clip.mp4.poster.webp'))).size > 0);
    assert.equal(shippedPoster.subarray(0, 4).toString(), 'RIFF');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
