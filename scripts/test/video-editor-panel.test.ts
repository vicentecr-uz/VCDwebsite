import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/DevVideoEditor.astro', import.meta.url), 'utf8');

test('video editor uses the shared image crop geometry and dimensions helper', () => {
  expect(source).toContain("import { imageSourceDims } from '../lib/projectImageFrame';");
  expect(source).toContain("preview.style.width = `calc(100% / ${rendered.w})`");
  expect(source).toContain('cropBounds(variant, dims)');
  expect(source).toContain('variant.w * sourceAspect /');
});

test('cancel restores the original target and save skips unchanged drafts', () => {
  expect(source).toContain("cancel.addEventListener('click', () => close(false)");
  expect(source).toContain('sameDraft(variants, savedVariants, audio, savedAudio)');
  expect(source).toContain('target.className = baselineClassName');
});

test('history updates the pending record for the edited target', () => {
  expect(source).toContain('upsertPending(editedTarget, before.variants, before.audio)');
  expect(source).toContain('upsertPending(editedTarget, after.variants, after.audio)');
  expect(source).toContain('...(subject.dataset.devImageSrc ?');
});
