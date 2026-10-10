import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { normalizeHref } from '../../src/lib/normalizeHref.mjs';

const source = readFileSync(new URL('../../src/components/Header.astro', import.meta.url), 'utf8');
const start = source.indexOf('  const linkEditor =');
const scriptEnd = source.indexOf('\n  }\n\n  // Switching between hover and tap', start);
const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, scriptEnd));
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture(ok = true) {
  const window = new Window({ url: 'http://localhost:4323/' });
  const document = window.document;
  document.body.innerHTML = [0, 1].map((index) => `<div class="header-menu__item"><a class="header-menu__link" href="/${index}"><span data-dev-text-path='["menuLinks",${index},"label"]'>Label</span></a><button data-dev-header-link-trigger data-menu-index="${index}"></button></div>`).join('')
    + '<div data-dev-header-link-editor hidden><span class="dev-text-field__prefix"></span><input data-dev-header-link-input><p data-dev-header-link-error></p></div>';
  const panel = document.querySelector<HTMLElement>('[data-dev-header-link-editor]')!;
  panel.showPopover = () => {};
  panel.hidePopover = () => {};
  const input = panel.querySelector<HTMLInputElement>('input')!;
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
  const requests: any[] = [];
  let writes = 0;
  window.addEventListener('vcd:dev-content-written', () => writes++);
  new Function('env', `with(env) { ${script} }`)({
    document, window, CustomEvent: window.CustomEvent, Event: window.Event,
    normalizeHref, initTextField() {}, syncMenuSurfaceInlineSize() {},
    fetch: async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return { ok, json: async () => ok ? { ok: true } : { error: 'Save failed' } };
    },
  });
  const key = (key: string) => input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return { window, document, panel, input, buttons, requests, key, writes: () => writes };
}

test('Enter saves a normalized URL to the selected field and closes', async () => {
  const f = fixture();
  f.buttons[1].click();
  expect(f.input.value).toBe('/1');
  f.input.value = 'example.com/work';
  f.key('Enter');
  await settle();
  expect(f.requests[0].changes).toEqual([{ document: 'header-settings', path: ['menuLinks', 1, 'href'], value: 'https://example.com/work' }]);
  expect(f.panel.hidden).toBe(true);
  expect(f.writes()).toBe(1);
});

test('Escape discards while clicking away saves', async () => {
  const f = fixture();
  f.buttons[0].click();
  f.input.value = '/discard';
  f.key('Escape');
  expect(f.panel.hidden).toBe(true);
  expect(f.requests).toHaveLength(0);
  f.buttons[0].click();
  f.input.value = '/keep';
  f.document.body.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true }));
  await settle();
  expect(f.requests[0].changes[0].value).toBe('/keep');
  expect(f.panel.hidden).toBe(true);
});

test('invalid URLs and failed saves preserve the draft when another cog is clicked', async () => {
  const f = fixture(false);
  f.buttons[0].click();
  f.input.value = 'javascript:alert(1)';
  f.buttons[1].click();
  await settle();
  expect(f.requests).toHaveLength(0);
  expect(f.input.value).toBe('javascript:alert(1)');
  expect(f.panel.hidden).toBe(false);
  f.input.value = '/retry';
  f.buttons[1].click();
  await settle();
  expect(f.input.value).toBe('/retry');
  expect(f.panel.hidden).toBe(false);
  expect(f.input.disabled).toBe(false);
  expect(f.panel.querySelector('[data-dev-header-link-error]')!.textContent).toBe('Save failed');
});

test('switching cogs saves the previous field before opening the next one', async () => {
  const f = fixture();
  f.buttons[0].click();
  f.input.value = '/previous';
  f.buttons[1].click();
  await settle();
  expect(f.requests[0].changes[0].path).toEqual(['menuLinks', 0, 'href']);
  expect(f.input.value).toBe('/1');
  expect(f.panel.hidden).toBe(false);
  f.window.dispatchEvent(new f.window.CustomEvent('vcd:dev-mode-change', { detail: { active: false } }));
  expect(f.panel.hidden).toBe(true);
});
