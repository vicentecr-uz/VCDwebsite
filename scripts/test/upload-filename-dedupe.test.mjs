import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { uniqueUploadFilename } from '../dev-api-plugins.mjs';

async function withMediaDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vcd-upload-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a free name is taken as-is', () => withMediaDir(async (dir) => {
  assert.equal(await uniqueUploadFilename(dir, 'Hero.png', Buffer.from('a')), 'Hero.png');
}));

test('re-dropping identical bytes reuses the existing file', () => withMediaDir(async (dir) => {
  const bytes = Buffer.from('the same photo');
  await writeFile(path.join(dir, 'Hero.png'), bytes);
  assert.equal(await uniqueUploadFilename(dir, 'Hero.png', bytes), 'Hero.png');
}));

test('different bytes under the same name still get a suffix', () => withMediaDir(async (dir) => {
  await writeFile(path.join(dir, 'Hero.png'), Buffer.from('first'));
  assert.equal(await uniqueUploadFilename(dir, 'Hero.png', Buffer.from('second')), 'Hero-2.png');
}));

test('the match is found past an occupied suffix, not only at the base name', () => withMediaDir(async (dir) => {
  const bytes = Buffer.from('the same photo');
  await writeFile(path.join(dir, 'Hero.png'), Buffer.from('first'));
  await writeFile(path.join(dir, 'Hero-2.png'), bytes);
  assert.equal(await uniqueUploadFilename(dir, 'Hero.png', bytes), 'Hero-2.png');
}));

test('without contents the caller keeps the old suffix behaviour', () => withMediaDir(async (dir) => {
  await writeFile(path.join(dir, 'Hero.png'), Buffer.from('first'));
  assert.equal(await uniqueUploadFilename(dir, 'Hero.png'), 'Hero-2.png');
}));
