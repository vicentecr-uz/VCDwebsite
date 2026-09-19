import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { getPageMediaFeatures } from '../../src/lib/pageMediaFeatures';

test('detects gallery, captions, lightbox images, and nested videos', () => {
  assert.deepEqual(getPageMediaFeatures(`
    <div class="project-grid"><div class="carousel"><video data-project-inline-video></video></div></div>
    <figure class="project-caption"></figure><img data-image-original="/full.jpg">
  `), { gallery: true, captions: true, lightbox: true, video: true });
});

test('requires exact class tokens and nonempty lightbox values', () => {
  assert.deepEqual(getPageMediaFeatures(`
    <div class="project-gridish project-caption-extra"></div>
    <img data-image-original="   "><img data-image-original="/original.jpg">
  `), { gallery: false, captions: false, lightbox: true, video: false });
});

test('ignores misleading text, comments, scripts, styles, and escaped markup', () => {
  assert.deepEqual(getPageMediaFeatures(`
    <!-- <div class="project-grid"><video data-project-inline-video></video></div> -->
    <script>const html = '<div class="project-grid"><img data-image-original="x">';</script>
    <style>.project-caption { content: '<video data-project-inline-video>'; }</style>
    &lt;img data-image-original="fake"&gt;
  `), { gallery: false, captions: false, lightbox: false, video: false });
});

test('traverses template content', () => {
  assert.deepEqual(getPageMediaFeatures(`
    <template><div class="project-grid"><img data-image-original="/full.jpg"></div></template>
  `), { gallery: true, captions: false, lightbox: true, video: false });
});
