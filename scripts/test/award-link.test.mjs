import assert from 'node:assert/strict';
import { normalizeHref } from '../../src/lib/normalizeHref.mjs';

assert.equal(normalizeHref(' example.com/award '), 'https://example.com/award');
assert.equal(normalizeHref('/awards/if-design'), '/awards/if-design');
assert.equal(normalizeHref('mailto:hello@example.com'), 'mailto:hello@example.com');
assert.equal(normalizeHref('javascript:alert(1)'), null);
assert.equal(normalizeHref('data:text/html,unsafe'), null);
assert.equal(normalizeHref(''), null);
