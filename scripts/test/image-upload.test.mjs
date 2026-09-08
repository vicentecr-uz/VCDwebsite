import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  convertHeicUpload,
  HeicConversionError,
} from '../../scripts/dev-api-plugins.mjs';
import { isAcceptedImageFile, isHeicUpload, uploadFilename } from '../../src/lib/imageUpload.mjs';

test('recognizes uppercase HEIC with an empty browser MIME', () => {
  assert.equal(isAcceptedImageFile({ name: 'PHOTO.HEIC', type: '' }), true);
  assert.equal(isHeicUpload('PHOTO.HEIC', ''), true);
  assert.equal(uploadFilename('PHOTO.HEIC', ''), 'PHOTO.jpg');
  assert.equal(isAcceptedImageFile({ name: 'photo.txt', type: '' }), false);
  assert.equal(isAcceptedImageFile({ name: 'photo.HEIC', type: 'text/plain' }), false);
});

test('converts with explicit sips arguments and cleans its temporary directory', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vcd-heic-test-'));
  let invocation;
  try {
    const converted = await convertHeicUpload(Buffer.from('heic bytes'), {
      tmpdir: tempRoot,
      run: async (command, args) => {
        invocation = { command, args };
        await writeFile(args.at(-1), 'jpeg bytes');
      },
    });
    assert.equal(converted.toString(), 'jpeg bytes');
    assert.equal(invocation.command, '/usr/bin/sips');
    assert.deepEqual(invocation.args.slice(0, 6), ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90']);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('uses a stable conversion error without exposing process details', async () => {
  await assert.rejects(
    convertHeicUpload(Buffer.from('heic bytes'), { run: async () => { throw new Error('/tmp/private sips output'); } }),
    (error) => error instanceof HeicConversionError
      && error.code === 'HEIC_CONVERSION_FAILED'
      && error.message === 'Could not convert HEIC image to JPEG.',
  );
});

test('keeps the bundled helper bridge and URL measurement branch', async () => {
  const source = await readFile(new URL('../../src/components/DevProjectGridEditor.astro', import.meta.url), 'utf8');
  assert.match(source, /window\.__vcdIsAcceptedImageFile = isAcceptedImageFile/);
  assert.match(source, /ownsObjectUrl = file instanceof File/);
  assert.match(source, /objectUrl = ownsObjectUrl \? URL\.createObjectURL\(file\)/);
  assert.match(source, /window\.__vcdMeasureHoverDark\(window\.__vcdIsHeicUpload/);
});
