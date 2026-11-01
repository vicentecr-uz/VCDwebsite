import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const start = source.indexOf('    const positionFormatBar =');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  source.slice(start, source.indexOf('    const updateFormatBar =', start)) + '\nreturn positionFormatBar;',
);

function place({ mobile = true, link = false, reveal = false, caretTop = 170, viewport = { offsetLeft: 0, offsetTop: 100, width: 393, height: 300 } } = {}) {
  const window = new Window({ width: 1200, height: 900 });
  const document = window.document;
  document.body.innerHTML = '<div id="bar"><div class="dev-text-format__surface"><div class="dev-text-format__buttons"></div></div></div>';
  const bar = document.getElementById('bar')!;
  const surface = bar.firstElementChild as HTMLElement;
  const buttons = surface.firstElementChild as HTMLElement;
  Object.defineProperty(window, 'visualViewport', { value: viewport });
  // Layout measurements are supplied; these tests exercise placement, not browser rendering.
  buttons.getBoundingClientRect = () => ({ width: mobile ? 365 : 600, height: mobile ? 44 : 32 }) as DOMRect;
  const rect = { left: 32, width: 0, top: caretTop, bottom: caretTop + 20, height: 20 };
  const scrolls: number[] = [];
  const position = new Function('env', `with(env) { ${script} }`)({
    window: { visualViewport: window.visualViewport, innerWidth: 1200, innerHeight: 900, matchMedia: () => ({ matches: mobile }), scrollBy: ({ top }: { top: number }) => scrolls.push(top) },
    document, formatBar: bar, savedFormatFocusEdge: 'end', linkPanelOpen: link, formatPlacement: 'above',
    findBlockState: () => ({ state: { element: document.body } }),
    getFormatEndpointLineRect: () => rect,
    getComputedStyle: () => ({ paddingLeft: '6', paddingRight: '6', paddingTop: '6', paddingBottom: '6', borderLeftWidth: '0', borderRightWidth: '0', borderTopWidth: '0', borderBottomWidth: '0', rowGap: '4' }),
    measureLinkPanelHeight: () => 44, FORMAT_BAR_GAP: 8,
    isFormatBarTarget: () => false, syncFormatSelectionOverlay() {},
  });
  position({ commonAncestorContainer: document.body, getBoundingClientRect: () => rect }, reveal);
  return { bar, surface, scrolls, reserve: document.documentElement.style.getPropertyValue('--dev-mobile-format-space'), left: Number.parseFloat(bar.style.left), top: Number.parseFloat(bar.style.top) };
}

test('one-row phone toolbar docks above the keyboard independently of the caret', () => {
  const { bar, surface, left, top } = place();
  expect(bar.style.getPropertyValue('--dev-format-content-width')).toBe('365px');
  expect(surface.style.width).toBe('377px');
  expect(left).toBe(8);
  expect(top).toBe(336);
  expect(top + 56).toBe(392);
});

test('link row stays above keyboard with a panned visual viewport', () => {
  const { left, top } = place({ link: true, caretTop: 350, viewport: { offsetLeft: 60, offsetTop: 100, width: 393, height: 300 } });
  expect(left).toBe(68);
  expect(top).toBeGreaterThanOrEqual(108);
  expect(top + 104).toBe(392);
});

test('manual page scrolling keeps phone controls available without pulling the caret back', () => {
  const { bar, scrolls, top } = place({ caretTop: 450 });
  expect(bar.classList.contains('is-dev-text-format-offscreen')).toBe(false);
  expect(bar.inert).toBe(false);
  expect(scrolls).toEqual([]);
  expect(top).toBe(336);
});

test('typing reveals only the obscured caret line and reserves room at the document end', () => {
  const { scrolls, reserve } = place({ caretTop: 350, reveal: true });
  expect(scrolls).toEqual([42]);
  expect(reserve).toBe('572px');
  expect(place({ caretTop: 170, reveal: true }).scrolls).toEqual([]);
});

test('desktop still suppresses a toolbar whose selection has scrolled out of view', () => {
  const { bar } = place({ mobile: false, caretTop: 450 });
  expect(bar.classList.contains('is-dev-text-format-offscreen')).toBe(true);
  expect(bar.inert).toBe(true);
});

test('desktop keeps one-row width and reserves the link row', () => {
  const { surface, top } = place({ mobile: false, caretTop: 300, viewport: { offsetLeft: 0, offsetTop: 0, width: 1200, height: 900 } });
  expect(surface.style.width).toBe('612px');
  expect(top).toBe(200);
});
