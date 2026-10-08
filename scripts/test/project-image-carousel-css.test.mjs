import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/styles/project.css', import.meta.url), 'utf8');
const track = css.slice(css.indexOf('.project-image-carousel__track {'), css.indexOf('/* Pin-to-tallest', css.indexOf('.project-image-carousel__track {')));
const vertical = css.slice(css.indexOf(".project-image-carousel[data-orientation='vertical'] .project-image-carousel__track {"), css.indexOf(".project-image-carousel[data-orientation='vertical'] .project-image-carousel__slide"));
const verticalClip = css.slice(css.indexOf(".project-image-carousel[data-orientation='vertical'] .project-image-carousel__clip {"), css.indexOf(".project-image-carousel[data-orientation='vertical'] .project-image-carousel__slide"));
assert.match(track, /overscroll-behavior-x:\s*contain/);
assert.match(vertical, /overscroll-behavior-y:\s*contain/);
assert.match(vertical, /overscroll-behavior-x:\s*auto/);
assert.match(verticalClip, /flex:\s*1 1 0/);
assert.match(track, /translate:\s*var\(--project-carousel-rubberband-x/);
assert.doesNotMatch(css.slice(css.indexOf('.project-image-carousel__slide {'), css.indexOf('/* Dynamic horizontal')), /translate:\s*var\(--project-carousel-rubberband/);
assert.match(css, /@property --project-carousel-track-size\s*\{[\s\S]*?syntax:\s*"\*";[\s\S]*?inherits:\s*false;/);
assert.match(css, /@property --project-carousel-track-port-size\s*\{[\s\S]*?syntax:\s*"\*";[\s\S]*?inherits:\s*false;/);
assert.match(css.slice(css.indexOf('.project-image-carousel[data-height-mode=\'dynamic\']'), css.indexOf('/* Vertical:')), /height:\s*var\(--project-carousel-track-size/);
assert.match(css.slice(css.indexOf('.project-image-carousel[data-height-mode=\'dynamic\']'), css.indexOf('/* Vertical:')), /height:\s*var\(--project-carousel-track-port-size/);
