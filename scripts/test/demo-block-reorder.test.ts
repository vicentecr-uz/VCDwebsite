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
  expect(document.documentElement.classList.contains('is-section-reorder-holding')).toBe(true);

  const moveDown = new win.Event('keydown', { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(moveDown, 'key', { value: 'ArrowDown' });
  handles[0].dispatchEvent(moveDown);
  await flush();

  const reset = root.querySelector<HTMLButtonElement>('[data-reorder-demo-reset]')!;
  reset.click();
  expect(settled).toBeGreaterThanOrEqual(1);
  expect(document.documentElement.classList.contains('is-section-reorder-holding')).toBe(false);
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

  handles[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  expect(document.documentElement.classList.contains('is-section-reorder-holding')).toBe(false);
  handles[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(reorder.guideLift(blocks[1], 0, 0)).toBe(true);
  expect(document.documentElement.classList.contains('is-section-reorder-holding')).toBe(false);
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

test('re-lifts a block while its drop is settling', async () => {
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
  (win.HTMLElement.prototype as HTMLElement & { animate?: unknown }).animate = (_keyframes: Keyframe[], options: KeyframeAnimationOptions = {}) => {
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
    const timer = win.setTimeout(resolveFinished, Number(options.duration) || 0);
    return {
      finished,
      cancel() {
        win.clearTimeout(timer);
        resolveFinished();
      },
    } as unknown as Animation;
  };
  document.body.innerHTML = `<div>
    <div data-reorder-demo-list>
      <article data-reorder-demo-block data-title="One"><button data-reorder-demo-handle></button><div class="dev-section-lift-backdrop"></div></article>
      <article data-reorder-demo-block data-title="Two"><button data-reorder-demo-handle></button><div class="dev-section-lift-backdrop"></div></article>
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
    onLift: () => { lifted += 1; },
    onSettle: () => { settled += 1; },
  });

  const pointer = (type: string, pointerId: number) => {
    const event = new win.Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
    Object.assign(event, { button: 0, pointerId, clientX: 20, clientY: 20 });
    return event;
  };
  handles[0].dispatchEvent(pointer('pointerdown', 1));
  handles[0].dispatchEvent(pointer('pointerup', 1));
  expect(document.documentElement.classList.contains('is-section-reorder-holding')).toBe(false);
  handles[0].dispatchEvent(pointer('pointerdown', 2));
  expect(lifted).toBe(2);
  expect(settled).toBe(0);
  expect(blocks[0].classList.contains('is-section-lifted-session')).toBe(true);
  expect(blocks[0].querySelector('.dev-section-lift-backdrop')?.classList.contains('is-visible')).toBe(true);

  await new Promise<void>((resolve) => setTimeout(resolve, 650));
  expect(blocks[0].classList.contains('is-section-lifted-session')).toBe(true);
  expect(settled).toBe(0);
  expect(blocks[0].querySelector<HTMLElement>('.dev-section-lift-backdrop')?.style.boxShadow).toBe('');

  handles[0].dispatchEvent(pointer('pointerup', 2));
  await new Promise<void>((resolve) => setTimeout(resolve, 650));
  expect(settled).toBeGreaterThanOrEqual(1);
  expect(blocks[0].classList.contains('is-section-lifted-session')).toBe(false);
  expect(blocks[0].querySelector('.dev-section-lift-backdrop')?.classList.contains('is-visible')).toBe(false);

  handles[0].dispatchEvent(pointer('pointerdown', 3));
  handles[0].dispatchEvent(pointer('pointerup', 3));
  handles[1].dispatchEvent(pointer('pointerdown', 4));
  expect(lifted).toBe(4);
  expect(settled).toBeGreaterThanOrEqual(2);
  expect(blocks[0].classList.contains('is-section-lifted-session')).toBe(false);
  expect(blocks[1].classList.contains('is-section-lifted-session')).toBe(true);
  expect(blocks[1].querySelector('.dev-section-lift-backdrop')?.classList.contains('is-visible')).toBe(true);

  await new Promise<void>((resolve) => setTimeout(resolve, 650));
  expect(blocks[1].classList.contains('is-section-lifted-session')).toBe(true);
  expect(blocks[1].querySelector('.dev-section-lift-backdrop')?.classList.contains('is-visible')).toBe(true);

  handles[1].dispatchEvent(pointer('pointerup', 4));
  await new Promise<void>((resolve) => setTimeout(resolve, 650));
  root.querySelector<HTMLButtonElement>('[data-reorder-demo-reset]')?.click();
  expect(document.documentElement.classList.contains('is-section-reorder-holding')).toBe(false);
  expect(blocks.some((block) => block.classList.contains('is-section-lifted-session'))).toBe(false);
  expect(blocks.some((block) => block.querySelector('.dev-section-lift-backdrop')?.classList.contains('is-visible'))).toBe(false);
  handles[0].dispatchEvent(pointer('pointerdown', 5));
  handles[0].dispatchEvent(pointer('pointercancel', 5));
  expect(document.documentElement.classList.contains('is-section-reorder-holding')).toBe(false);
  handles[0].dispatchEvent(pointer('pointerdown', 6));
  reorder.destroy();
  expect(document.documentElement.classList.contains('is-section-reorder-holding')).toBe(false);
});
