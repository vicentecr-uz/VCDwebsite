import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { spacingButtonsHtml } from '../../src/lib/gapSpacingControl';

const source = readFileSync(new URL('../../src/components/project/demos/GapSpacingDemo.astro', import.meta.url))
  .toString().split('<script>')[1].split('</script>')[0];
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

function setup() {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<vcd-gap-spacing-demo>
    <div data-gap-viewport><div data-gap-space></div><div data-gap-toolbar><div data-gap-control>
      ${spacingButtonsHtml(false, false)}
    </div></div></div><button data-gap-reset>Reset</button>
  </vcd-gap-spacing-demo>`;
  const viewport = document.querySelector('[data-gap-viewport]') as HTMLElement;
  const toolbar = document.querySelector('[data-gap-toolbar]') as HTMLElement;
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  win.setTimeout = ((callback: () => void) => {
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  }) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof win.clearTimeout;
  viewport.getBoundingClientRect = () => ({ top: 0, left: 0, right: 320, bottom: 480 } as DOMRect);
  const gap = document.querySelector('[data-gap-space]') as HTMLElement;
  gap.getBoundingClientRect = () => {
    const value = gap.style.getPropertyValue('--gap-spacing-value');
    const heights = value.includes('section') ? 128 : value.includes('major') ? 192 : value.includes('related') ? 16 : 64;
    return { top: 100, height: heights } as DOMRect;
  };
  const env = { HTMLElement: win.HTMLElement, customElements: win.customElements, document, window: win, AbortController: win.AbortController };
  new Function('env', `with (env) { ${compiled} }`)(env);
  return { win, document, host: document.querySelector('vcd-gap-spacing-demo')!, viewport, toolbar, timers, flushTimers: () => { [...timers.values()].forEach((callback) => callback()); timers.clear(); } };
}

const event = (win: Window, type: string, values: Record<string, unknown> = {}) => {
  const result = new win.Event(type, { bubbles: false, cancelable: true }) as Event & Record<string, unknown>;
  Object.assign(result, values);
  return result;
};

test('freezes the toolbar while changing the gap, then releases it through relocation', () => {
  const h = setup();
  const choice = h.document.querySelector('[data-dev-spacing-option="section"]') as HTMLButtonElement;
  expect(h.toolbar.style.top).toBe('132px');
  h.toolbar.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'mouse' }));
  choice.click();
  expect(choice.getAttribute('aria-pressed')).toBe('true');
  expect(h.document.querySelector('[data-gap-space]')!.getAttribute('style')).toContain('var(--space-section)');
  expect(h.toolbar.style.top).toBe('132px');
  h.toolbar.dispatchEvent(event(h.win, 'pointerleave'));
  expect(h.toolbar.hasAttribute('data-relocating')).toBe(true);
  h.flushTimers();
  expect(h.toolbar.hasAttribute('data-relocating')).toBe(false);
  expect(h.toolbar.style.top).toBe('164px');
  expect(h.toolbar.hasAttribute('data-visible')).toBe(true);
  h.host.remove();
});

test('reset cancels pending relocation and restores 4em and scroll position', () => {
  const h = setup();
  const viewport = h.viewport;
  viewport.scrollTop = 120;
  h.toolbar.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'mouse' }));
  (h.document.querySelector('[data-dev-spacing-option="major"]') as HTMLButtonElement).click();
  h.toolbar.dispatchEvent(event(h.win, 'pointerleave'));
  (h.document.querySelector('[data-gap-reset]') as HTMLButtonElement).click();
  expect(viewport.scrollTop).toBe(0);
  expect(h.document.querySelector('[data-dev-spacing-option="group"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(h.toolbar.style.top).toBe('132px');
  h.flushTimers();
  expect(h.toolbar.style.top).toBe('132px');
  expect(h.toolbar.hasAttribute('data-relocating')).toBe(false);
  h.host.remove();
});

test('touch choices reanchor immediately and wheel prevention stays on the toolbar', () => {
  const h = setup();
  const choice = h.document.querySelector('[data-dev-spacing-option="major"]') as HTMLButtonElement;
  h.toolbar.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'touch' }));
  h.toolbar.dispatchEvent(event(h.win, 'pointerdown', { pointerType: 'touch' }));
  choice.click();
  expect(h.toolbar.style.top).toBe('196px');
  const toolbarWheel = event(h.win, 'wheel');
  h.toolbar.dispatchEvent(toolbarWheel);
  expect(toolbarWheel.defaultPrevented).toBe(true);
  const viewportWheel = event(h.win, 'wheel');
  h.viewport.dispatchEvent(viewportWheel);
  expect(viewportWheel.defaultPrevented).toBe(false);
  h.host.remove();
});

test('disconnect clears pending timers and aborts choice listeners', () => {
  const h = setup();
  const choice = h.document.querySelector('[data-dev-spacing-option="section"]') as HTMLButtonElement;
  h.toolbar.dispatchEvent(event(h.win, 'pointerenter', { pointerType: 'mouse' }));
  h.toolbar.dispatchEvent(event(h.win, 'pointerleave'));
  expect(h.timers.size).toBeGreaterThan(0);
  const gap = h.document.querySelector('[data-gap-space]') as HTMLElement;
  const before = gap.getAttribute('style');
  h.host.remove();
  expect(h.timers.size).toBe(0);
  choice.click();
  expect(gap.getAttribute('style')).toBe(before);
});
