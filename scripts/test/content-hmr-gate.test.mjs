import { contentHmrGate } from '../content-hmr-gate.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const gate = contentHmrGate();
const blocked = (file) => gate.handleHotUpdate({ file });
const allowed = (file) => gate.handleHotUpdate({ file }) === undefined;

test('suppresses settings content HMR', () => assert.deepEqual(blocked('/repo/src/content/settings/header.json'), []));
test('suppresses pages content HMR', () => assert.deepEqual(blocked('/repo/src/content/pages/home.json'), []));
test('suppresses projects content HMR', () => assert.deepEqual(blocked('/repo/src/content/projects/sample-modern.json'), []));
test('suppresses media HMR', () => assert.deepEqual(blocked(path.join(process.cwd(), 'media/sample-modern/image.svg')), []));
test('allows ordinary engine updates', () => assert.equal(allowed('/repo/src/components/Header.astro'), true));
test('allows ordinary stylesheet updates', () => assert.equal(allowed('/repo/src/styles/global.css'), true));
