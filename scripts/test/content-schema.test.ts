import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'bun:test';
import {
  validateContentVersion,
  validateHeaderSettings,
  validatePageDocument,
  validateProjectDocument,
} from '../../src/lib/content-schema';

const root = path.resolve(import.meta.dirname, '../..');

test('accepts modern and legacy documents while preserving extensions', () => {
  const modern = { title: 'Sample', stack: 'modern', sections: [{ type: 'bodyText', paragraphs: ['Hello'], extra: 1 }] };
  const legacy = { title: 'Legacy', stack: 'legacy', sections: [{ type: 'tagline', text: 'Hello' }] };
  assert.equal((validateProjectDocument(modern, 'modern.json') as typeof modern).sections[0].extra, 1);
  assert.equal((validateProjectDocument(legacy, 'legacy.json') as typeof legacy).stack, 'legacy');
});

test('rejects unknown types, stack mismatches, and invalid nested fields with paths', () => {
  assert.throws(() => validateProjectDocument({ title: 'x', stack: 'modern', sections: [{ type: 'prose', paragraphs: [] }] }, 'sample.json'), /sample\.json: sections\[0\]\.type/);
  assert.throws(() => validateProjectDocument({ title: 'x', stack: 'modern', sections: [{ type: 'bodyText', paragraphs: 'no' }] }, 'sample.json'), /sample\.json: sections\[0\]\.paragraphs/);
  assert.throws(() => validateProjectDocument({ title: 'x', stack: 'legacy', sections: [{ type: 'interactiveDemo', demo: 'x' }] }, 'sample.json'), /sample\.json: sections\[0\]\.type/);
  assert.throws(() => validateProjectDocument({ title: 'x', stack: 'modern', sections: [{ type: 'bodyText', paragraphs: [42] }] }, 'sample.json'), /sample\.json: sections\[0\]\.paragraphs/);
  assert.throws(() => validateProjectDocument({ title: 'x', stack: 'modern', sections: [{ type: 'imageGrid', items: [null] }] }, 'sample.json'), /sample\.json: sections\[0\]\.items\[0\]/);
  assert.throws(() => validateProjectDocument({ title: 'x', stack: 'modern', sections: [{ type: 'interactiveDemo', demo: 'unknown-demo' }] }, 'sample.json'), /sample\.json: sections\[0\]\.demo/);
  assert.throws(() => validateProjectDocument({ title: 'x', schemaVersion: 2, sections: [] }, 'sample.json'), /sample\.json: schemaVersion/);
  assert.throws(() => validateProjectDocument({ title: 'x', stack: 'modern', sections: [{ type: 'pressQuoteTicker', items: [{ quote: 'q' }] }] }, 'sample.json'), /sample\.json: sections\[0\]\.items\[0\]/);
  assert.throws(() => validateProjectDocument({ title: 'x', stack: 'modern', sections: [{ type: 'redditCommentCarousel', items: [{ author: 'a', paragraphs: [42], score: 1 }] }] }, 'sample.json'), /sample\.json: sections\[0\]\.items\[0\]/);
});

test('validates pages, settings, and schema versions', () => {
  validatePageDocument({ sections: [{ type: 'projectGrid', variant: 'home' }] }, 'home.json');
  validateHeaderSettings({ siteTitle: 'Vince', logoPath: '/logo.svg', menuLinks: [{ label: 'Home', href: '/' }] }, 'header.json');
  assert.deepEqual(validateContentVersion(undefined), { schemaVersion: 1 });
  assert.deepEqual(validateContentVersion({ schemaVersion: 1 }), { schemaVersion: 1 });
  assert.throws(() => validateContentVersion({ schemaVersion: 2 }, 'schema.json'), /schema\.json: schemaVersion/);
  assert.throws(() => validateContentVersion({}, 'schema.json'), /schema\.json: schemaVersion/);
});

for (const source of ['src/content', 'scripts/test/fixtures/content/src/content']) test(`${source} documents satisfy the contract`, async () => {
  for (const directory of ['projects', 'pages']) {
    const files = await Array.fromAsync(new Bun.Glob(`${source}/${directory}/*.json`).scan({ cwd: root }));
    assert.ok(files.length > 0);
    for (const file of files) {
      const document = JSON.parse(await readFile(path.join(root, file), 'utf8'));
      if (directory === 'projects') validateProjectDocument(document, file);
      else validatePageDocument(document, file);
    }
  }
  validateHeaderSettings(JSON.parse(await readFile(path.join(root, source, 'settings/header.json'), 'utf8')), `${source}/settings/header.json`);
});

test('rejects incomplete instance style examples', () => {
  assert.throws(() => validatePageDocument({ sections: [], examples: { hero: '/hero.svg' } }, 'styles.json'), /styles\.json: examples\.detail/);
});
