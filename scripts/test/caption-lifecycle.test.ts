import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { IMAGE_VIEWPORTS } from '../../src/lib/responsiveImage';
import * as captions from '../../src/lib/imageCaptions';
import { createPageScope, onPageLoad } from '../../src/lib/pageLifecycle';
import { createHistory, pageHistory, registerHistoryScope } from '../../src/lib/devHistory';
import { devEditPendingId } from '../../src/scripts/devEditTarget';

test('caption selection, live text and Save survive repeated page replacements', async () => {
  const window = new Window({ url: 'http://localhost:4322/goodhome' });
  const globals = {
    window, document: window.document, HTMLElement: window.HTMLElement,
    Element: window.Element, Node: window.Node, NodeFilter: window.NodeFilter,
    Event: window.Event, CustomEvent: window.CustomEvent,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }));
  window.document.documentElement.classList.add('is-dev-mode');
  const render = () => {
    window.document.body.innerHTML = `<main id="main-content">
      <div class="project-image" data-dev-image-target data-dev-document="projects/goodhome" data-dev-image-path='["sections",0]'>
        <button class="dev-caption-add-trigger" data-caption-action="add"></button>
      </div>
      <div data-dev-panel-key="caption" hidden><div data-project-image-caption-tuner>
        <button data-caption-viewport="desktop"></button><button data-caption-viewport="tablet"></button><button data-caption-viewport="mobile"></button>
        <button data-caption-style="white"></button><button data-caption-style="below"></button>
        <select data-caption-position></select><select data-caption-reveal><option value="hover">On hover</option><option value="always">Always visible</option></select>
        <textarea data-caption-text></textarea><p data-caption-status></p>
        <button data-caption-save></button><button data-caption-cancel></button><button data-caption-revert></button><button data-caption-clear></button>
      </div></div></main>`;
    return window.document.querySelector<HTMLElement>('[data-project-image-caption-tuner]')!;
  };
  window.addEventListener('error', event => { throw event.error; });
  const pending: any[] = [];
  window.addEventListener('vcd:dev-pending-upsert', (event: any) => pending.push(event.detail));
  let dispose: (() => void) | undefined;
  try {
    let tuner = render();
    const source = readFileSync(new URL('../../src/components/project/ProjectImageCaptionTuner.astro', import.meta.url), 'utf8');
    const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace('import.meta.hot?.dispose(disposePage);', 'return disposePage;');
    const env = { ...captions, IMAGE_VIEWPORTS, createPageScope, onPageLoad, createHistory, pageHistory, registerHistoryScope,
      devEditPendingId, captionCornerConflictsWithChrome: () => false, refreshProjectCropCovers: () => {} };
    dispose = new Function(...Object.keys(env), new Bun.Transpiler({ loader: 'ts' }).transformSync(script))(...Object.values(env));
    const stale: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
      if (i) {
        window.document.dispatchEvent(new window.Event('astro:before-swap'));
        stale.push(tuner);
        tuner = render();
        window.document.dispatchEvent(new window.Event('astro:page-load'));
        window.document.dispatchEvent(new window.Event('astro:page-load'));
      }
      const panel = tuner.parentElement!;
      const target = window.document.querySelector<HTMLElement>('[data-dev-image-target]')!;
      window.dispatchEvent(new window.CustomEvent('vcd:dev-edit-open', { detail: { panel, trigger: target.querySelector('button') } }));
      const selected = tuner.querySelector<HTMLElement>('[data-caption-style="white"]')!;
      expect(selected.getAttribute('aria-pressed')).toBe('true');
      expect(selected.classList.contains('is-selected')).toBe(true);
      const text = tuner.querySelector<HTMLTextAreaElement>('textarea')!;
      text.value = `caption ${i}`;
      text.dispatchEvent(new window.Event('input', { bubbles: true }));
      expect(target.querySelector('[data-caption-bp="desktop"]')?.textContent).toBe(`caption ${i}`);
      tuner.querySelector<HTMLButtonElement>('[data-caption-save]')!.click();
      expect(pending.length).toBe(i + 1);
      expect(pending.at(-1).payload.captions.desktop).toBe(`caption ${i}`);
      expect(target.dataset.devCaptions).toContain(`caption ${i}`);
      expect(panel.hidden).toBe(true);
      stale.forEach(old => old.querySelector<HTMLButtonElement>('[data-caption-save]')!.click());
      expect(pending.length).toBe(i + 1);
    }
  } finally {
    dispose?.();
    pageHistory.clear();
    previous.forEach((descriptor, key) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
    await window.happyDOM.close();
  }
});
