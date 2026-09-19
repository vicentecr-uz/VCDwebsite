import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../../src/styles/project.css', import.meta.url), 'utf8');
const carousel = readFileSync(new URL('../../src/components/project/ProjectImageCarousel.astro', import.meta.url), 'utf8');

test('crop column guides cover inline, lead, grid, and carousel images only when full bleed', () => {
  assert.deepEqual(
    css.match(/\.is-dev-mode :is\(([^)]*)\)\[data-mobile-bleed-eligible='true'\]:not\(\[data-mobile-inset='true'\]\) > \.dev-crop-stage::before/)?.[1].split(', '),
    ['.project-media', '.project-image', '.project-image-grid__item'],
  );
  assert.match(css, /inset-inline-start: var\(--page-gutter\)/);
  assert.match(css, /inset-inline-end: var\(--page-gutter\)/);
  assert.match(carousel, /'project-image-carousel__slide',\s*'project-image-grid__item'/);
});
