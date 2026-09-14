import assert from 'node:assert/strict';
import test from 'node:test';
import {
  imageVariantSettingSource,
  imageVariantsSavePayload,
  resetImageVariantSetting,
  setImageVariantSetting,
} from '../../src/lib/imageVariantInheritance';
import type { ImageVariants } from '../../src/lib/responsiveImage';

const crop = { aspect: '3:2', cx: 0.2, cy: 0.7, w: 0.8 };

test('finds the nearest authored source for each setting', () => {
  const variants: ImageVariants = { desktop: { aspect: '3:2' }, tablet: { cx: 0.2, cy: 0.5, w: 1 } };
  assert.equal(imageVariantSettingSource(variants, 'mobile', 'aspect'), 'desktop');
  assert.equal(imageVariantSettingSource(variants, 'mobile', 'crop'), 'tablet');
  assert.equal(imageVariantSettingSource(variants, 'desktop', 'crop'), undefined);
});

test('resets aspect and crop independently', () => {
  const variants: ImageVariants = { tablet: { aspect: '3:2', cx: 0.2, cy: 0.5, w: 1 } };
  assert.deepEqual(resetImageVariantSetting(variants, 'tablet', 'aspect'), { tablet: { cx: 0.2, cy: 0.5, w: 1 } });
  assert.deepEqual(resetImageVariantSetting(variants, 'tablet', 'crop'), { tablet: { aspect: '3:2' } });
});

test('writes only the selected setting and isolates clones', () => {
  const variants: ImageVariants = { tablet: { aspect: '4:3', cx: 0.1 } };
  const next = setImageVariantSetting(variants, 'tablet', 'crop', crop);
  assert.deepEqual(variants, { tablet: { aspect: '4:3', cx: 0.1 } });
  assert.deepEqual(next, { tablet: { aspect: '4:3', cx: 0.2, cy: 0.7, w: 0.8 } });
  next.tablet!.cx = 0.9;
  assert.equal(variants.tablet!.cx, 0.1);
});

test('retains explicit equal values and emits a complete sparse payload', () => {
  const variants: ImageVariants = { desktop: { aspect: '3:2' }, tablet: { aspect: '3:2' } };
  assert.equal(imageVariantSettingSource(variants, 'tablet', 'aspect'), 'tablet');
  assert.deepEqual(imageVariantsSavePayload(variants), {
    desktop: { aspect: '3:2' }, tablet: { aspect: '3:2' }, mobile: {},
  });
});
