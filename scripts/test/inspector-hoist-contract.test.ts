import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../node_modules/${path}`, import.meta.url), 'utf8');

test('Lapse still has the bar host, the picker host and the drag functions the canvas relies on', () => {
  const source = read('@aiforui/lapse/dist/panel.mjs');
  for (const needle of ['data-lapse-slot', 'data-lapse-scope-ui', 'const viewport = () =>', 'const onPointerMove = ', 'const onPointerUp = ']) {
    expect(source).toContain(needle);
  }
  expect(source).toMatch(/const viewport = \(\) => \(\{\s*W: document\.documentElement\.clientWidth \|\| window\.innerWidth/);
});

test('Agentation still has the toolbar and the drag functions the canvas relies on', () => {
  const source = read('agentation/dist/index.mjs');
  for (const needle of ['data-agentation-toolbar', 'data-agentation-root', 'const handleMouseMove = ', 'const constrainPosition = ']) {
    expect(source).toContain(needle);
  }
  expect(source).toMatch(/const constrainPosition = \(\) => \{[\s\S]{0,600}window\.innerWidth/);
});
