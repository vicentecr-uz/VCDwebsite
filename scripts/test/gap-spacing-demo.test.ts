import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { spacingButtonsHtml } from '../../src/lib/gapSpacingControl';
import { createDemoGapSpacing } from '../../src/lib/demoGapSpacing';
import { readFileSync } from 'node:fs';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const event = (win: Window, type: string, values: Record<string, unknown> = {}) => {
  const result = new win.Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(result, key, { configurable: true, value }));
  return result;
};

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<vcd-gap-spacing-demo>
    <div data-reorder-demo-list>
      <article data-reorder-demo-block data-title="First"><img src="/one.jpg"><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><div class="dev-gap-toolbar__spacing">${spacingButtonsHtml(false, false)}</div></div></div></article>
      <article data-reorder-demo-block data-title="Second"><img src="/two.jpg"><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><div class="dev-gap-toolbar__spacing">${spacingButtonsHtml(false, false)}</div></div></div></article>
      <article data-reorder-demo-block data-title="Third"><img src="/three.jpg"><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><div class="dev-gap-toolbar__spacing">${spacingButtonsHtml(false, false)}</div></div></div></article>
    </div>
    <button data-reorder-demo-reset>Reset</button>
  </vcd-gap-spacing-demo>`;
  const root = document.querySelector('vcd-gap-spacing-demo') as HTMLElement;
  const toolbars = [...root.querySelectorAll<HTMLElement>('[data-gap-toolbar]')];
  toolbars.forEach((toolbar, index) => {
    const pill = toolbar.querySelector<HTMLElement>('.dev-gap-toolbar__pill')!;
    pill.getBoundingClientRect = () => ({ left: 100, right: 140, top: 100 + index * 80, bottom: 120 + index * 80, width: 40, height: 20 } as DOMRect);
  });
  const api = createDemoGapSpacing(root);
  return { win, document, root, toolbars, api, blocks: [...root.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')] };
}

test('mouse pin captures fixed rect before changing gap, then fades and unpins', async () => {
  const h = setup();
  const toolbar = h.toolbars[1];
  const pill = toolbar.querySelector('.dev-gap-toolbar__pill')!;
  pill.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'mouse' }));
  expect(toolbar.style.position).toBe('fixed');
  const choice = toolbar.querySelector('[data-dev-spacing-option="section"]') as HTMLButtonElement;
  const click = event(h.win, 'click', { detail: 1 });
  choice.dispatchEvent(click);
  expect(h.blocks[1].style.getPropertyValue('--demo-block-gap')).toContain('var(--space-section)');
  expect(toolbar.style.position).toBe('fixed');
  pill.dispatchEvent(event(h.win, 'pointerleave'));
  await wait(160);
  expect(toolbar.style.position).toBe('');
  expect(toolbar.hasAttribute('data-relocating')).toBe(false);
});

test('nearest gap uses 140ms intent, 8px entry, and 24px retention', async () => {
  const h = setup();
  const toolbar = h.toolbars[1];
  h.root.dispatchEvent(event(h.win, 'pointermove', { pointerType: 'mouse', clientX: 148, clientY: 190, timeStamp: 1 }));
  expect(toolbar.classList.contains('is-near-spacing')).toBe(false);
  await wait(100);
  expect(toolbar.classList.contains('is-near-spacing')).toBe(false);
  await wait(60);
  expect(toolbar.classList.contains('is-near-spacing')).toBe(true);
  h.root.dispatchEvent(event(h.win, 'pointermove', { pointerType: 'mouse', clientX: 160, clientY: 190, timeStamp: 2 }));
  expect(toolbar.classList.contains('is-near-spacing')).toBe(true);
  h.root.dispatchEvent(event(h.win, 'pointermove', { pointerType: 'mouse', clientX: 200, clientY: 190, timeStamp: 3 }));
  expect(toolbar.classList.contains('is-near-spacing')).toBe(false);
});

test('wheel prevents scrolling only while a pill is visible', () => {
  const h = setup();
  const toolbar = h.toolbars[1];
  const pill = toolbar.querySelector('.dev-gap-toolbar__pill')!;
  const hiddenWheel = event(h.win, 'wheel');
  pill.dispatchEvent(hiddenWheel);
  expect(hiddenWheel.defaultPrevented).toBe(false);
  pill.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'mouse' }));
  const visibleWheel = event(h.win, 'wheel');
  pill.dispatchEvent(visibleWheel);
  expect(visibleWheel.defaultPrevented).toBe(true);
});

test('keyboard choices stay focusable and touch choices unpin immediately', () => {
  const h = setup();
  const toolbar = h.toolbars[1];
  const pill = toolbar.querySelector('.dev-gap-toolbar__pill')!;
  pill.dispatchEvent(event(h.win, 'focusin'));
  const keyboardChoice = toolbar.querySelector('[data-dev-spacing-option="major"]') as HTMLButtonElement;
  Object.defineProperty(keyboardChoice, 'isConnected', { value: true });
  const keyboardClick = event(h.win, 'click', { detail: 0 });
  keyboardChoice.dispatchEvent(keyboardClick);
  expect(keyboardChoice.classList.contains('is-active')).toBe(true);
  pill.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'mouse' }));
  pill.dispatchEvent(event(h.win, 'pointerdown', { pointerType: 'touch' }));
  const touchChoice = toolbar.querySelector('[data-dev-spacing-option="section"]') as HTMLButtonElement;
  touchChoice.dispatchEvent(event(h.win, 'click', { detail: 1 }));
  expect(toolbar.style.position).toBe('');
  expect(touchChoice.classList.contains('is-active')).toBe(true);
});

test('first block gap never reveals and suppression blocks reveal and selection', async () => {
  const h = setup();
  const firstPill = h.toolbars[0].querySelector('.dev-gap-toolbar__pill')!;
  firstPill.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'mouse' }));
  h.root.dispatchEvent(event(h.win, 'pointermove', { pointerType: 'mouse', clientX: 120, clientY: 110, timeStamp: 1 }));
  await wait(160);
  expect(h.toolbars[0].classList.contains('is-near-spacing')).toBe(false);
  h.api.setSuppressed(true);
  const choice = h.toolbars[1].querySelector('[data-dev-spacing-option="major"]') as HTMLButtonElement;
  choice.dispatchEvent(event(h.win, 'click', { detail: 1 }));
  expect(h.blocks[1].style.getPropertyValue('--demo-block-gap')).toContain('var(--space-group)');
  h.api.destroy();
});

test('reset restores each block to 4em and clears pending timers', async () => {
  const h = setup();
  const api = h.api;
  h.toolbars.slice(1).forEach((toolbar) => {
    (toolbar.querySelector('[data-dev-spacing-option="major"]') as HTMLButtonElement).dispatchEvent(event(h.win, 'click', { detail: 1 }));
  });
  api.reset();
  expect(h.blocks.every((block) => block.style.getPropertyValue('--demo-block-gap').includes('var(--space-group)'))).toBe(true);
  await wait(180);
  expect(h.toolbars.every((toolbar) => !toolbar.hasAttribute('data-relocating'))).toBe(true);
  api.destroy();
});

test('destroy aborts listeners and clears visible state', () => {
  const h = setup();
  const api = h.api;
  api.destroy();
  const pill = h.toolbars[1].querySelector('.dev-gap-toolbar__pill')!;
  pill.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'mouse' }));
  expect(h.toolbars[1].classList.contains('is-near-spacing')).toBe(false);
});

test('Astro lifecycle wires crop suppression, outside click, reset scroll, and disconnect cleanup', () => {
  const source = readFileSync(new URL('../../src/components/project/demos/GapSpacingDemo.astro', import.meta.url), 'utf8')
    .split('<script>')[1].split('</script>')[0].replace(/^\s*import .*?;\s*$/gm, '');
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<main data-page-viewport><vcd-gap-spacing-demo><div data-block-guide-cursor></div><div data-reorder-demo-list>
    <article data-reorder-demo-block data-demo-spacing data-block-kind="title"><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><div class="dev-gap-toolbar__spacing">${spacingButtonsHtml(false, false)}</div></div></div></article>
    <article data-reorder-demo-block data-demo-spacing data-block-kind="image"><div class="project-image"><img src="/source.jpg"></div><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><div class="dev-gap-toolbar__spacing">${spacingButtonsHtml(false, false)}</div></div></div></article>
    <article data-reorder-demo-block data-demo-spacing data-block-kind="text"><div data-gap-toolbar><div class="dev-gap-toolbar__pill"><div class="dev-gap-toolbar__spacing">${spacingButtonsHtml(false, false)}</div></div></div></article>
    </div><div class="block-demo-actions"><div data-block-save-bar hidden><button data-block-revert disabled>Revert</button><button data-block-save disabled>Save</button></div></div><div class="demo-controls gap-spacing-demo__reset-controls"><button data-gap-reset data-reorder-demo-reset>Reset</button></div></vcd-gap-spacing-demo></main>`;
  let cropActive = false;
  let cropState = { source: { src: '/source.jpg', width: 100, height: 80, alt: 'source' }, crop: { aspect: '4:3', cx: 0.5, cy: 0.5, w: 0.8 }, locked: true };
  let gapSuppressed = false;
  let lift: (() => void) | undefined;
  let settle: (() => void) | undefined;
  let resetScroll = false;
  let guideStops = 0;
  let guidePlays = 0;
  let gapApi: ReturnType<typeof createDemoGapSpacing> | undefined;
  const env = {
    HTMLElement: win.HTMLElement, customElements: win.customElements, document, window: win, AbortController: win.AbortController,
    createDemoImageCrop: (options: { onChange?: () => void }) => ({ reset() {}, destroy() {}, setActive(value: boolean) { cropActive = value; }, getState: () => structuredClone(cropState), restore: (value: typeof cropState) => { cropState = structuredClone(value); options.onChange?.(); return true; } }),
    createDemoGapSpacing: (root: HTMLElement, options: { onChange?: () => void }) => { gapApi = createDemoGapSpacing(root, options); const api = gapApi; return { ...api, setSuppressed(value: boolean) { gapSuppressed = value; api.setSuppressed(value); } }; },
    createDemoBlockReorder: (root: HTMLElement, options: { onLift?: () => void; onSettle?: () => void }) => { lift = options.onLift; settle = options.onSettle; const list = root.querySelector<HTMLElement>('[data-reorder-demo-list]')!; return { reset() {}, destroy() {}, getOrder: () => [...list.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')], restore(order: HTMLElement[]) { order.forEach((block) => list.append(block)); }, guideLift: () => false, guideMove() {}, guideDrop: async () => {}, cancel() {}, guideTarget() {} }; },
    createDemoBlockGuide: () => ({ stop() { guideStops += 1; }, play() { guidePlays += 1; }, destroy() {} }),
  };
  new Function('env', `with (env) { ${compiled} }`)(env);
  const demo = document.querySelector('vcd-gap-spacing-demo') as HTMLElement;
  const viewport = document.querySelector<HTMLElement>('[data-page-viewport]')!;
  viewport.scrollTo = () => { resetScroll = true; };
  win.scrollTo = () => { throw new Error('reset should use the demo viewport'); };
  const actionBar = document.querySelector<HTMLElement>('[data-block-save-bar]')!;
  expect(document.querySelector('.block-demo-actions')?.parentElement).toBe(document.body);
  expect(document.querySelector('.gap-spacing-demo__reset-controls')?.parentElement).toBe(document.body);
  expect(document.querySelector('[data-block-guide-cursor]')?.parentElement).toBe(document.body);
  const save = document.querySelector<HTMLButtonElement>('[data-block-save]')!;
  const revert = document.querySelector<HTMLButtonElement>('[data-block-revert]')!;
  expect(actionBar.hidden).toBe(true);
  const gapChoice = demo.querySelectorAll<HTMLButtonElement>('[data-dev-spacing-option="section"]')[1];
  gapChoice.click();
  expect(actionBar.hidden).toBe(false);
  expect(demo.querySelectorAll('[data-demo-spacing].is-dev-spacing-dirty').length).toBe(1);
  expect(save.disabled).toBe(false);
  save.click();
  expect(demo.querySelectorAll('[data-demo-spacing].is-dev-spacing-dirty').length).toBe(0);
  const list = demo.querySelector<HTMLElement>('[data-reorder-demo-list]')!;
  const blocks = [...list.querySelectorAll<HTMLElement>('[data-reorder-demo-block]')];
  list.append(blocks[0]);
  cropState = { ...cropState, source: { ...cropState.source, src: '/changed.jpg' } };
  demo.querySelectorAll<HTMLButtonElement>('[data-dev-spacing-option="major"]')[1].click();
  expect(demo.querySelectorAll('[data-demo-spacing].is-dev-spacing-dirty').length).toBe(1);
  expect(actionBar.hidden).toBe(false);
  revert.click();
  expect([...list.querySelectorAll('[data-reorder-demo-block]')][0]).toBe(blocks[0]);
  expect(cropState.source.src).toBe('/source.jpg');
  expect(demo.querySelectorAll('[data-demo-spacing].is-dev-spacing-dirty').length).toBe(0);
  expect(actionBar.hidden).toBe(true);
  const trigger = demo.querySelector('.dev-image-edit-trigger') as HTMLButtonElement;
  trigger.click();
  expect(cropActive).toBe(true);
  lift?.();
  expect(gapSuppressed).toBe(true);
  settle?.();
  expect(gapSuppressed).toBe(false);
  document.dispatchEvent(event(win, 'pointerdown', { target: document.body }));
  document.querySelector('[data-gap-reset]')?.dispatchEvent(event(win, 'click'));
  expect(resetScroll).toBe(true);
  expect(gapApi?.getState()).toEqual(['group', 'related', 'group']);
  expect(actionBar.hidden).toBe(true);
  expect(guideStops).toBeGreaterThan(0);
  expect(guidePlays).toBeGreaterThan(0);
  demo.remove();
  expect(demo.querySelector('.block-demo-actions')).toBeTruthy();
  expect(demo.querySelector('.gap-spacing-demo__reset-controls')).toBeTruthy();
  expect(demo.querySelector('[data-block-guide-cursor]')).toBeTruthy();
  expect(demo.querySelector('.dev-image-edit-trigger')).toBeNull();
  viewport.append(demo);
  expect(document.querySelectorAll('.block-demo-actions')).toHaveLength(1);
  expect(document.querySelector('.block-demo-actions')?.parentElement).toBe(document.body);
  expect(document.querySelector('[data-block-guide-cursor]')?.parentElement).toBe(document.body);
  demo.remove();
  expect(document.querySelector('.block-demo-actions')).toBeNull();
});
