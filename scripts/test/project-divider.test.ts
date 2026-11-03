import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createPageScope } from '../../src/lib/pageLifecycle';

const source = readFileSync(new URL('../../src/components/project/ProjectDivider.astro', import.meta.url), 'utf8');
const script = source.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.replace(/^\s*import .*?;\s*$/gm, '').replaceAll('import.meta.env.DEV', 'true'));

async function measure(blocks: Array<{ top: number; bottom: number; divider?: boolean }>) {
  const win = new Window();
  win.document.body.innerHTML = `<main id="main-content"><div data-dev-project-drop-zone>${blocks.map(block => `<section ${block.divider ? 'class="project-divider" data-dev-section-deletable="divider"' : ''}></section>`).join('')}</div></main>`;
  const elements = [...win.document.querySelectorAll('section')];
  elements.forEach((element, index) => { element.getBoundingClientRect = () => blocks[index] as DOMRect; });
  let cleanup: (() => void) | undefined;
  class Observer { observe() {} unobserve() {} disconnect() {} }
  new Function('createPageScope', 'onPageLoad', 'document', 'window', 'ResizeObserver', compiled)(
    createPageScope,
    (mount: () => (() => void)) => { cleanup = mount(); },
    win.document,
    new EventTarget(),
    Observer,
  );
  const result = elements.filter(element => element.classList.contains('project-divider')).map(element => ({
    before: parseFloat(element.style.getPropertyValue('--divider-hover-before')),
    after: parseFloat(element.style.getPropertyValue('--divider-hover-after')),
  }));
  const originalCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: win.cancelAnimationFrame.bind(win) });
  try { cleanup?.(); }
  finally {
    if (originalCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', originalCancel);
    else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    await win.happyDOM.close();
  }
  return result;
}

test('related 16px gaps give a 33px divider target without changing its line box', async () => {
  const [insets] = await measure([{ top: 0, bottom: 50 }, { top: 66, bottom: 67, divider: true }, { top: 83, bottom: 120 }]);
  expect(insets).toEqual({ before: 16, after: 16 });
  expect(insets.before + 1 + insets.after).toBe(33);
});

test('generous gaps cap hover expansion at 20px per side', async () => {
  expect(await measure([{ top: 0, bottom: 50 }, { top: 100, bottom: 101, divider: true }, { top: 160, bottom: 200 }])).toEqual([{ before: 20, after: 20 }]);
});

test('touching or overlapping neighbors leave no hover expansion over their content', async () => {
  expect(await measure([{ top: 0, bottom: 67 }, { top: 66, bottom: 67, divider: true }, { top: 67, bottom: 90 }])).toEqual([{ before: 0, after: 0 }]);
});

test('adjacent dividers split their shared whitespace so targets never overlap', async () => {
  const insets = await measure([{ top: 0, bottom: 50 }, { top: 66, bottom: 67, divider: true }, { top: 83, bottom: 84, divider: true }, { top: 100, bottom: 150 }]);
  expect(insets).toEqual([{ before: 16, after: 8 }, { before: 8, after: 16 }]);
  expect(insets[0].after + insets[1].before).toBe(16);
});

test('a lone divider stays within its parent rather than inventing outer whitespace', async () => {
  expect(await measure([{ top: 0, bottom: 1, divider: true }])).toEqual([{ before: 0, after: 0 }]);
});
