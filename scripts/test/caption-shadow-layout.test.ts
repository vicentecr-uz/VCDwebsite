import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../../src/components/project/ProjectCaptionShadow.astro', import.meta.url), 'utf8');
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  source.split('<script>')[1].split('</script>')[0].replaceAll('import.meta.hot', 'hot'),
);

test('caption shadow follows moved text after frame changes and CSS updates', () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<figure><span class="project-caption"><span data-caption-bp="mobile">Caption</span></span></figure>';
  const parent = document.querySelector('figure')!;
  const caption = document.querySelector<HTMLElement>('.project-caption')!;
  const text = caption.querySelector<HTMLElement>('[data-caption-bp]')!;
  let inset = 12;
  parent.getBoundingClientRect = () => new window.DOMRect(0, 0, 360, 400);
  caption.getBoundingClientRect = text.getBoundingClientRect = () => new window.DOMRect(inset, 400 - inset - 20, 100, 20);
  Object.defineProperty(caption, 'offsetParent', { get: () => parent });
  let pending: FrameRequestCallback | undefined;
  const hotHandlers = new Map<string, () => void>();
  window.requestAnimationFrame = (callback) => { pending = callback; return 1; };
  window.cancelAnimationFrame = () => { pending = undefined; };
  const flush = () => { const callback = pending; pending = undefined; callback?.(0); };
  new Function('env', `with (env) { ${script} }`)({
    window, document, HTMLElement: window.HTMLElement, Text: window.Text,
    Node: window.Node, DOMRect: window.DOMRect, MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    hot: { on: (event: string, callback: () => void) => hotHandlers.set(event, callback) },
  });
  window.dispatchEvent(new window.Event('load'));
  const fill = caption.querySelector<HTMLElement>('.project-caption-shadow__fill')!;
  expect(fill.style.width).toBe('210px');
  expect(fill.style.height).toBe('50px');

  inset = 32;
  window.dispatchEvent(new window.Event('vcd:dev-frame-changed'));
  flush();
  expect(fill.style.width).toBe('250px');
  expect(fill.style.height).toBe('90px');

  inset = 48;
  hotHandlers.get('vite:afterUpdate')?.();
  flush();
  expect(fill.style.width).toBe('282px');
  expect(fill.style.height).toBe('122px');
  window.happyDOM.abort();
});
