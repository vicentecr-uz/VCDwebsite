import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../../src/components/DevLogIssue.astro', import.meta.url), 'utf8');
const script = source
  .slice(source.indexOf('<script>') + '<script>'.length, source.indexOf('</script>'))
  .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
  .replace('import.meta.hot?.dispose(dispose);', '')
  .replace('    scope.add(stopPickMode);\n  };\n\n  initDevLogIssue();', '    scope.add(stopPickMode);\n    return { submitIssue };\n  };\n\n  return initDevLogIssue();');

const fixture = () => `
  <main id="main-content">
    <aside data-dev-overlay data-dev-panel-key="log-issue">
      <div data-dev-log-issue>
        <input data-log-title>
        <textarea data-log-body></textarea>
        <div data-log-drop><span data-log-drop-label>Drop files</span><ul data-log-files hidden></ul><input data-log-file-input></div>
        <div class="dev-field"><div class="dev-field__value"><select data-log-label aria-hidden="true" tabindex="-1"><option value="">Select…</option><option value="bug">Bug</option></select><button id="log-label-trigger" class="dev-select__trigger" data-editor-select-trigger type="button">Select…</button></div></div>
        <div class="dev-field"><div class="dev-field__value"><select data-log-page-label aria-hidden="true" tabindex="-1"><option value="">Select…</option></select><button data-editor-select-trigger type="button">Select…</button></div></div>
        <div class="dev-field"><div class="dev-field__value"><select data-log-milestone aria-hidden="true" tabindex="-1"><option value="">Select…</option><option value="v1">V1</option></select><button id="log-milestone-trigger" class="dev-select__trigger" data-editor-select-trigger type="button">Select…</button></div></div>
        <button data-log-pick type="button"></button><button data-log-clear type="button"></button><p data-log-picked></p>
        <button data-log-cancel type="button"></button><button data-log-submit type="button"></button>
        <div data-log-veil hidden><div data-log-veil-card><p data-log-veil-message></p><div data-log-veil-actions hidden></div><button data-log-veil-no></button><button data-log-veil-yes></button></div></div>
      </div>
    </aside>
  </main>
  <div data-log-pick-outline hidden></div>
`;

const makeFixture = () => {
  const window = new Window();
  const { document } = window;
  document.body.innerHTML = fixture();
  const listeners = new AbortController();
  let controller: { submitIssue: () => Promise<void> };
  const createPageScope = () => ({
    signal: listeners.signal,
    add() {},
    listen(target: EventTarget | null | undefined, type: string, listener: EventListener, options: AddEventListenerOptions | boolean = {}) {
      target?.addEventListener(type, listener, { ...(typeof options === 'boolean' ? { capture: options } : options), signal: listeners.signal });
    },
    frame(callback: FrameRequestCallback) { callback(0); return 0; },
    timeout(callback: () => void, delay = 0) { return window.setTimeout(callback, delay); },
    destroy() {},
  });
  let fetches = 0;
  const env = {
    document,
    window,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    FileReader: window.FileReader,
    CustomEvent: window.CustomEvent,
    Option: window.Option,
    fetch: async () => { fetches += 1; return new window.Response('{}', { status: 500 }); },
    onPageLoad: (mount: () => unknown) => { controller = mount() as typeof controller; return () => {}; },
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; },
    cancelAnimationFrame: () => {},
    createPageScope,
    getLastPointerPosition: () => ({ x: 0, y: 0 }),
  };
  window.matchMedia = () => ({ matches: true, media: '', onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  new Function(...Object.keys(env), new Bun.Transpiler({ loader: 'ts' }).transformSync(script))(...Object.values(env));
  return {
    window,
    document,
    controller,
    get fetches() { return fetches; },
    async cleanup() {
      listeners.abort();
      await window.happyDOM.close();
    },
  };
};

test('missing issue selects focus their visible Base UI triggers without submitting', async () => {
  const h = makeFixture();
  try {
    const title = h.document.querySelector<HTMLInputElement>('[data-log-title]')!;
    const body = h.document.querySelector<HTMLTextAreaElement>('[data-log-body]')!;
    const label = h.document.querySelector<HTMLSelectElement>('[data-log-label]')!;
    const milestone = h.document.querySelector<HTMLSelectElement>('[data-log-milestone]')!;
    const labelField = label.closest<HTMLElement>('.dev-field')!;
    const milestoneField = milestone.closest<HTMLElement>('.dev-field')!;
    title.value = 'A title';
    body.value = 'A description';
    milestone.value = 'v1';
    await h.controller.submitIssue();
    assert.equal(h.document.activeElement?.id, 'log-label-trigger');
    assert.equal(labelField.hasAttribute('data-log-validation-focus'), true);
    assert.equal(h.fetches, 0);

    label.value = 'bug';
    milestone.value = '';
    await h.controller.submitIssue();
    assert.equal(h.document.activeElement?.id, 'log-milestone-trigger');
    assert.equal(labelField.hasAttribute('data-log-validation-focus'), false);
    assert.equal(milestoneField.hasAttribute('data-log-validation-focus'), true);
    assert.equal(h.fetches, 0);

    (h.document.activeElement as HTMLElement).blur();
    assert.equal(milestoneField.hasAttribute('data-log-validation-focus'), false);
  } finally {
    await h.cleanup();
  }
});

test('issue panel Escape leaves Base UI popup dismissal to the popup and cancels otherwise', async () => {
  const h = makeFixture();
  try {
    const panel = h.document.querySelector<HTMLElement>('[data-dev-overlay]')!;
    const popup = h.document.createElement('div');
    popup.dataset.editorSelectPopup = '';
    const option = h.document.createElement('button');
    popup.append(option);
    h.document.body.append(popup);
    const popupEscape = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    option.dispatchEvent(popupEscape);
    assert.equal(popupEscape.defaultPrevented, false);
    assert.equal(panel.hidden, false);

    const trigger = h.document.querySelector<HTMLButtonElement>('#log-label-trigger')!;
    trigger.setAttribute('aria-expanded', 'true');
    const triggerEscape = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    trigger.dispatchEvent(triggerEscape);
    assert.equal(triggerEscape.defaultPrevented, false);
    assert.equal(panel.hidden, false);

    trigger.setAttribute('aria-expanded', 'false');
    const panelEscape = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    trigger.dispatchEvent(panelEscape);
    assert.equal(panelEscape.defaultPrevented, true);
    assert.equal(panel.hidden, true);
  } finally {
    await h.cleanup();
  }
});
