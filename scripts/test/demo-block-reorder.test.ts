import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoBlockReorder } from '../../src/lib/demoBlockReorder';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('scrolling demo measures flat-list margins through lift and target changes', async () => {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  Object.assign(globalThis, {
    window: win,
    document,
    HTMLElement: win.HTMLElement,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  });
  document.body.innerHTML = `<div>
    <div data-reorder-demo-list>
      <article data-reorder-demo-block data-title="One" style="margin-top: 0px"><button data-reorder-demo-handle></button></article>
      <article data-reorder-demo-block data-title="Two" style="margin-top: 16px"><button data-reorder-demo-handle></button></article>
      <article data-reorder-demo-block data-title="Three" style="margin-top: 24px"><button data-reorder-demo-handle></button></article>
    </div>
    <div class="reorder-demo__status"></div>
    <button data-reorder-demo-reset>Reset</button>
  </div>`;
  const root = document.body.firstElementChild as HTMLElement;
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')];
  blocks.forEach((block, index) => {
    block.getBoundingClientRect = () => ({ top: index * 80, left: 0, right: 320, bottom: index * 80 + 64, width: 320, height: 64 } as DOMRect);
  });
  const handles = blocks.map((block) => block.querySelector('button') as HTMLButtonElement);
  handles.forEach((handle) => {
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => false;
    handle.releasePointerCapture = () => {};
  });
  let lifted = 0;
  let settled = 0;
  const reorder = createDemoBlockReorder(root, {
    scroll: true,
    onLift: () => { lifted += 1; },
    onSettle: () => { settled += 1; },
  });

  const pointerDown = new win.Event('pointerdown', { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  Object.assign(pointerDown, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
  handles[0].dispatchEvent(pointerDown);
  await flush();
  expect(lifted).toBe(1);

  const moveDown = new win.Event('keydown', { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(moveDown, 'key', { value: 'ArrowDown' });
  handles[0].dispatchEvent(moveDown);
  await flush();

  const reset = root.querySelector<HTMLButtonElement>('[data-reorder-demo-reset]')!;
  reset.click();
  expect(settled).toBeGreaterThanOrEqual(1);
  expect(root.querySelector('[data-reorder-demo-list]')?.firstElementChild).toBe(blocks[0]);
  reorder.destroy();
});

test('scrolling demo keeps the lifted block gap in the final slot through drop', async () => {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  Object.assign(globalThis, {
    window: win,
    document,
    HTMLElement: win.HTMLElement,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  });
  document.body.innerHTML = `<div>
    <div data-reorder-demo-list>
      <article data-reorder-demo-block data-title="One" style="margin-top: 64px; --demo-block-gap: 64px"><button data-reorder-demo-handle></button></article>
      <article data-reorder-demo-block data-title="Two" style="margin-top: 64px; --demo-block-gap: 64px"><button data-reorder-demo-handle></button></article>
      <article data-reorder-demo-block data-title="Three" style="margin-top: 64px; --demo-block-gap: 64px"><button data-reorder-demo-handle></button></article>
    </div>
    <div class="reorder-demo__status"></div>
    <button data-reorder-demo-reset>Reset</button>
  </div>`;
  const root = document.body.firstElementChild as HTMLElement;
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')];
  blocks.forEach((block, index) => {
    block.getBoundingClientRect = () => ({ top: index * 128, left: 0, right: 320, bottom: index * 128 + 64, width: 320, height: 64 } as DOMRect);
  });
  const handles = blocks.map((block) => block.querySelector('button') as HTMLButtonElement);
  handles.forEach((handle) => {
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => false;
    handle.releasePointerCapture = () => {};
  });
  const reorder = createDemoBlockReorder(root, { scroll: true });

  expect(reorder.guideLift(blocks[1], 0, 0)).toBe(true);
  await flush();
  const indicator = root.querySelector<HTMLElement>('.dev-section-drop-indicator');
  expect(indicator).not.toBeNull();

  reorder.guideTarget(0);
  await flush();
  expect(indicator?.style.marginTop).toBe('0px');

  reorder.guideTarget(2);
  await flush();
  expect(indicator?.style.marginTop).toBe('64px');
  await reorder.guideDrop();
  expect(indicator?.style.marginTop).toBe('64px');
  expect(reorder.getOrder()).toEqual([blocks[0], blocks[2], blocks[1]]);
  reorder.destroy();
});
