import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/styles/project.css', import.meta.url), 'utf8');
const track = css.slice(css.indexOf('.project-image-carousel__track {'), css.indexOf('/* Pin-to-tallest', css.indexOf('.project-image-carousel__track {')));
const vertical = css.slice(css.indexOf(".project-image-carousel[data-orientation='vertical'] .project-image-carousel__track {"), css.indexOf(".project-image-carousel[data-orientation='vertical'] .project-image-carousel__slide"));
assert.match(track, /overscroll-behavior-x:\s*contain/);
assert.match(vertical, /overscroll-behavior-y:\s*contain/);
assert.match(vertical, /overscroll-behavior-x:\s*auto/);
assert.match(track, /translate:\s*var\(--project-carousel-rubberband-x/);
assert.doesNotMatch(css.slice(css.indexOf('.project-image-carousel__slide {'), css.indexOf('/* Dynamic horizontal')), /translate:\s*var\(--project-carousel-rubberband/);
