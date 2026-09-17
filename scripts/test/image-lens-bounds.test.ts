import assert from 'node:assert/strict';
import { imageLensBounds } from '../../src/lib/imageLensBounds';

for (const toolbarHeight of [44, 56]) for (let frameWidth = 280; frameWidth <= 1000; frameWidth++) {
  const phone = frameWidth < 480;
  const tablet = frameWidth < 768;
  const diameter = phone ? 124 : tablet ? 152 : 180;
  const depth = phone ? 25 : tablet ? 30 : 36;
  const edgeWidth = phone ? 22 : tablet ? 27 : 32;
  const width = Math.min(448, frameWidth - (frameWidth <= 640 ? 24 : 32));
  const height = width * 0.75;
  const verticalSpace = (576 - height) / 2;
  const toolbarGap = (verticalSpace - toolbarHeight) / 2;
  const gap = Math.min((frameWidth - width) / 2, verticalSpace, toolbarGap);
  const bounds = imageLensBounds({ width, height, diameter, depth, edgeWidth, refraction: 0.5, zoom: 2.5, gap });
  const radius = diameter / 2;
  const opticalReach = bounds.footprint;
  assert.ok(bounds.reach > 0 && bounds.min <= bounds.x && bounds.min <= bounds.y);
  assert.ok(bounds.boundaryRadius < radius, 'lens can rest partly outside the image');
  assert.ok(bounds.boundaryRadius < radius / 2.5, 'plain frame background is reachable at rest');
  for (const reach of [opticalReach]) {
    assert.ok(bounds.min + radius - bounds.reach - reach >= -gap + 4 - 1e-9, 'near edge is clear even at asymptotic stretch');
    assert.ok(bounds.x + radius + bounds.reach + reach <= width + gap - 4 + 1e-9, 'far edge is clear even at asymptotic stretch');
    assert.ok(bounds.y + radius + bounds.reach + reach <= height + gap - 4 + 1e-9, 'toolbar and bottom frame remain clear');
  }
  // Conservative sampler coverage includes both refracted rays and nearby rim-colour samples.
  assert.ok(bounds.padding >= depth * 2 * 0.5 * Math.sqrt(1.25) + 10);
  const oldWidth = Math.min(2048, (width + diameter * 2) * 4);
  const oldPixels = oldWidth * Math.round((height + diameter * 2) * oldWidth / (width + diameter * 2));
  const newPixels = ((diameter + bounds.padding * 2) * 2) ** 2;
  assert.ok(newPixels < oldPixels * 0.12, 'cropped source redraws at least 88% fewer pixels at DPR 2');
}
console.log('image-lens-bounds: passed (1442 frame/toolbar sizes, full stretch clearance, optical coverage, pixel budget)');
