import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoGapSpacing } from '../../src/lib/demoGapSpacing';
import { createDemoBlockReorder } from '../../src/lib/demoBlockReorder';

test('gap adapter restores tokens, reveals a block, and reports changes', () => {
  const win = new Window();
  const root = win.document.createElement('div');
  root.innerHTML = '<article data-reorder-demo-block><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><button data-dev-spacing-option="group"></button><button data-dev-spacing-option="section"></button></div></div></article><article data-reorder-demo-block><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><button data-dev-spacing-option="group"></button><button data-dev-spacing-option="section"></button></div></div></article>';
  const changes: number[] = [];
  const handle = createDemoGapSpacing(root, { initial: 'section', onChange: () => changes.push(1) });
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')];
  expect(handle.getState()).toEqual(['section', 'section']);
  handle.select(blocks[1], 'group');
  expect(handle.getState()).toEqual(['section', 'group']);
  handle.restore(['group', 'invalid' as 'group']);
  expect(handle.getState()).toEqual(['section', 'group']);
  handle.restore(['group', 'section']);
  expect(handle.getState()).toEqual(['group', 'section']);
  handle.reveal(blocks[1]);
  expect(root.querySelectorAll('.is-near-spacing').length).toBe(1);
  expect(changes.length).toBeGreaterThan(0);
  handle.destroy();
});

test('gap adapter tracks dirty spacing against saved block identities', () => {
  const win = new Window();
  const root = win.document.createElement('div');
  root.innerHTML = '<article data-reorder-demo-block><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><button data-dev-spacing-option="group"></button><button data-dev-spacing-option="section"></button></div></div></article><article data-reorder-demo-block><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><button data-dev-spacing-option="group"></button><button data-dev-spacing-option="section"></button></div></div></article>';
  const handle = createDemoGapSpacing(root);
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')];
  handle.setSavedState(['group', 'section']);
  expect(blocks.map((block) => block.classList.contains('is-dev-spacing-dirty'))).toEqual([false, true]);
  handle.select(blocks[0], 'section');
  expect(blocks.map((block) => block.classList.contains('is-dev-spacing-dirty'))).toEqual([true, true]);
  handle.restore(['group', 'section']);
  expect(blocks.map((block) => block.classList.contains('is-dev-spacing-dirty'))).toEqual([false, false]);
  handle.setSavedState(handle.getState());
  expect(blocks.some((block) => block.classList.contains('is-dev-spacing-dirty'))).toBe(false);
  handle.select(blocks[1], 'group');
  handle.destroy();
  expect(blocks.some((block) => block.classList.contains('is-dev-spacing-dirty'))).toBe(false);
});

test('reorder adapter exposes order and rejects foreign restore nodes', () => {
  const win = new Window();
  const root = win.document.createElement('div');
  root.innerHTML = '<div data-reorder-demo-list><article data-reorder-demo-block><button data-reorder-demo-handle></button></article><article data-reorder-demo-block><button data-reorder-demo-handle></button></article></div><div class="reorder-demo__status"></div><button data-reorder-demo-reset></button>';
  const handle = createDemoBlockReorder(root);
  const order = handle.getOrder();
  const foreign = win.document.createElement('article');
  handle.restore([foreign, order[1]]);
  expect(handle.getOrder()).toEqual(order);
  handle.restore([order[0], order[0]]);
  expect(handle.getOrder()).toEqual(order);
  handle.restore([...order].reverse());
  expect(handle.getOrder()).toEqual([order[1], order[0]]);
  handle.cancel();
  handle.destroy();
});
