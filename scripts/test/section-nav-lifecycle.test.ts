import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { onPageLoad } from '../../src/lib/pageLifecycle';
import { pageHistory, registerHistoryScope } from '../../src/lib/devHistory';
import * as outline from '../../src/lib/projectOutline';

test('section navigation reconnects after page swaps and leaves dropdown Escape to Base UI', async () => {
  const window = new Window();
  const globals = { window, document: window.document, HTMLElement: window.HTMLElement,
    Element: window.Element, Event: window.Event, CustomEvent: window.CustomEvent, Option: function (text: string, value: string) { const option = window.document.createElement('option'); option.textContent = text; option.value = value; return option; } };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  window.addEventListener('error', event => { throw event.error; });
  window.document.documentElement.classList.add('is-dev-mode', 'show-section-nav-editor');
  let entries: outline.OutlineEntry[] = [];
  const render = () => {
    window.document.body.innerHTML = `<main id="main-content"><div data-section-nav-root data-section-nav-document="fixture" data-section-nav-outline-only="true"></div>
      <div data-section-nav-main><section id="research" class="section-block"><h2 class="project-section-title">Research</h2></section></div>
      <div data-section-nav-editor><div data-dev-overlay data-dev-panel-key="section-nav" hidden>
        <select data-nav-block></select><input type="checkbox" data-nav-as-group><input type="checkbox" data-nav-as-section>
        <div class="section-nav-editor__field"><input data-nav-group-label></div><div class="section-nav-editor__field"><input data-nav-section-label></div>
        <div data-nav-title-vis><button data-nav-hide-sidebar></button></div><button data-nav-undo></button><button data-nav-redo></button><button data-nav-done></button>
      </div></div></main>`;
    return window.document.querySelector<HTMLElement>('[data-section-nav-editor]')!;
  };
  const updates: any[] = [];
  window.addEventListener('vcd:dev-pending-upsert', (event: any) => updates.push(event.detail));
  let dispose: (() => void) | undefined;
  try {
    let shell = render();
    const source = readFileSync(new URL('../../src/components/project/ProjectSectionNavEditor.astro', import.meta.url), 'utf8');
    const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace('import.meta.hot?.dispose(disposePage);', 'return disposePage;')
      .replace('if (import.meta.hot) import.meta.hot.dispose(() => dispose?.());', 'return () => dispose?.();');
    const env = { ...outline, onPageLoad, pageHistory, registerHistoryScope,
      initDevSectionOutlineSync: () => {}, syncDevSectionOutlineSidebar: () => {},
      getDevSectionOutline: () => entries, setDevSectionOutline: (next: outline.OutlineEntry[]) => { entries = next; },
      getSectionRootsInDomOrder: () => [], sectionIndexFromElement: () => 0, sizeIcon: () => '',
      imageIcon: '', textIcon: '', headingIcon: '', awardIcon: '', detailsIcon: '', quoteIcon: '', commentsIcon: '', blockIcon: '' };
    dispose = new Function(...Object.keys(env), new Bun.Transpiler({ loader: 'ts' }).transformSync(script))(...Object.values(env));
    const stale: HTMLInputElement[] = [];
    for (let i = 0; i < 3; i++) {
      if (i) {
        window.document.dispatchEvent(new window.Event('astro:before-swap'));
        entries = [];
        shell = render();
        window.document.dispatchEvent(new window.Event('astro:page-load'));
        window.document.dispatchEvent(new window.Event('astro:page-load'));
      }
      const panel = shell.querySelector<HTMLElement>('[data-dev-panel-key]')!;
      expect(panel.hidden).toBe(false);
      const block = window.document.getElementById('research')!;
      expect(block.getAttribute('role')).toBe('button');
      block.click();
      const input = shell.querySelector<HTMLInputElement>('[data-nav-as-section]')!;
      input.checked = true;
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      expect(entries[0]?.label).toBe('Research');
      expect(updates.length).toBe(i + 1);
      stale.forEach(old => { old.checked = false; old.dispatchEvent(new window.Event('change')); });
      expect(updates.length).toBe(i + 1);
      stale.push(input);
      const popup = window.document.createElement('div');
      popup.setAttribute('data-editor-select-popup', '');
      popup.innerHTML = '<button role="option">Research</button>';
      window.document.body.append(popup);
      const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      popup.firstElementChild!.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(false);
      expect(panel.hidden).toBe(false);
      panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(panel.hidden).toBe(true);
    }
  } finally {
    dispose?.();
    pageHistory.clear();
    previous.forEach((descriptor, key) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
    await window.happyDOM.close();
  }
});
