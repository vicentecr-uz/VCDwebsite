import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const start = source.indexOf('    const positionFormatBar =');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  source.slice(start, source.indexOf('    const updateFormatBar =', start)) + '\nreturn positionFormatBar;',
);

function place({ mobile = true, link = false, caretTop = 170, viewport = { offsetLeft: 0, offsetTop: 100, width: 393, height: 300 } } = {}) {
  const window = new Window({ width: 1200, height: 900 });
  const document = window.document;
  document.body.innerHTML = '<div id="bar"><div class="dev-text-format__surface"><div class="dev-text-format__buttons"></div></div></div>';
  const bar = document.getElementById('bar')!;
  const surface = bar.firstElementChild as HTMLElement;
  const buttons = surface.firstElementChild as HTMLElement;
  Object.defineProperty(window, 'visualViewport', { value: viewport });
  // Layout measurements are supplied; these tests exercise placement, not browser rendering.
  buttons.getBoundingClientRect = () => ({ width: mobile ? 365 : 600, height: mobile ? 92 : 32 }) as DOMRect;
  const rect = { left: 32, width: 0, top: caretTop, bottom: caretTop + 20, height: 20 };
  const position = new Function('env', `with(env) { ${script} }`)({
    window: { visualViewport: window.visualViewport, innerWidth: 1200, innerHeight: 900, matchMedia: () => ({ matches: mobile }) },
    document, formatBar: bar, savedFormatFocusEdge: 'end', linkPanelOpen: link, formatPlacement: 'above',
    findBlockState: () => ({ state: { element: document.body } }),
    getFormatEndpointLineRect: () => rect,
    getComputedStyle: () => ({ paddingLeft: '6', paddingRight: '6', paddingTop: '6', paddingBottom: '6', borderLeftWidth: '0', borderRightWidth: '0', borderTopWidth: '0', borderBottomWidth: '0', rowGap: '4' }),
    measureLinkPanelHeight: () => 44, FORMAT_BAR_GAP: 8,
    isFormatBarTarget: () => false, syncFormatSelectionOverlay() {},
  });
  position({ commonAncestorContainer: document.body, getBoundingClientRect: () => rect });
  return { bar, surface, left: Number.parseFloat(bar.style.left), top: Number.parseFloat(bar.style.top) };
}

test('phone toolbar measures within the visible width and sits below a caret near its top', () => {
  const { bar, surface, left, top } = place();
  expect(bar.style.getPropertyValue('--dev-format-content-width')).toBe('365px');
  expect(surface.style.width).toBe('377px');
  expect(left).toBe(8);
  expect(top).toBe(198);
  expect(top + 104).toBeLessThanOrEqual(392);
});

test('link row stays above keyboard with a panned visual viewport', () => {
  const { left, top } = place({ link: true, caretTop: 350, viewport: { offsetLeft: 60, offsetTop: 100, width: 393, height: 300 } });
  expect(left).toBe(68);
  expect(top).toBeGreaterThanOrEqual(108);
  expect(top + 152).toBeLessThanOrEqual(392);
});

test('caret hidden behind the keyboard suppresses the toolbar', () => {
  const { bar } = place({ caretTop: 450 });
  expect(bar.classList.contains('is-dev-text-format-offscreen')).toBe(true);
  expect(bar.inert).toBe(true);
});

test('desktop keeps one-row width and reserves the link row', () => {
  const { surface, top } = place({ mobile: false, caretTop: 300, viewport: { offsetLeft: 0, offsetTop: 0, width: 1200, height: 900 } });
  expect(surface.style.width).toBe('612px');
  expect(top).toBe(200);
});
