import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderHomeIntroAction } from '../../src/lib/homeIntroAction';
import { createHomeIntroController, syncHomeIntroActions } from '../../src/scripts/homeIntro';
import { readParagraphsValue } from '../../src/lib/devTextDom';
import intro from '../../src/content/pages/home-intro.json';

const originalGlobals = Object.fromEntries(['document', 'Element', 'HTMLElement', 'Event', 'CustomEvent'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const controllers: Array<ReturnType<typeof createHomeIntroController>> = [];
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.teardown());
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const fixture = (paragraphs = intro.sections[0].paragraphs) => {
  const dom = new Window();
  const document = dom.document;
  Object.assign(globalThis, { document, Element: dom.Element, HTMLElement: dom.HTMLElement, Event: dom.Event, CustomEvent: dom.CustomEvent });
  const surface = document.createElement('section');
  surface.innerHTML = `<div class="project-body-text" contenteditable="true">${paragraphs.map((p) => `<p>${renderHomeIntroAction(p)}</p>`).join('')}</div>`;
  const home = document.createElement('main');
  home.id = 'main-content';
  document.body.append(surface, home);
  return { dom, document, surface, home, body: surface.firstElementChild as HTMLElement };
};

test('the saved name line renders one native button inside the right-indent run', () => {
  const { surface } = fixture();
  const button = surface.querySelector('button[data-home-intro-okay]')!;
  expect(surface.querySelectorAll('button[data-home-intro-okay]')).toHaveLength(1);
  expect(button.getAttribute('type')).toBe('button');
  expect(button.textContent).toBe('View work →');
  expect(button.parentElement!.getAttribute('data-text-right-tab')).toBe('true');
  expect(button.closest('p')!.textContent).toBe('Vicente CruzView work →Design Engineer');
  expect(button.hasAttribute('href')).toBe(false);
});

test('removing the WIP notice keeps the action in the name paragraph', () => {
  const { body } = fixture(intro.sections[0].paragraphs.slice(1));
  const name = body.firstElementChild!;
  expect(name.querySelector('.text-emphasis')!.textContent).toBe('Vicente Cruz');
  expect(name.querySelector('button')!.textContent).toBe('View work →');
  expect(body.querySelectorAll('button')).toHaveLength(1);
});

test('View markup saves as editable source and edited labels survive mode changes', () => {
  const { body, surface } = fixture();
  expect(readParagraphsValue(body)).toEqual(intro.sections[0].paragraphs);
  syncHomeIntroActions(surface, true);
  expect(surface.querySelector('button[data-home-intro-okay]')).toBeNull();
  const label = surface.querySelector('span[data-home-intro-okay]')!;
  label.textContent = 'See work →';
  const saved = readParagraphsValue(body);
  body.innerHTML = saved.map((p) => `<p>${p}</p>`).join('');
  syncHomeIntroActions(surface, false);
  expect(surface.querySelector('button')!.textContent).toBe('See work →');
  expect(readParagraphsValue(body)).toEqual(saved);
});

test('restored Edit markup rebinds the recreated button and preserves focus transfer', async () => {
  const { dom, document, surface, home, body } = fixture();
  const controller = createHomeIntroController(surface, home, document.documentElement, dom as unknown as globalThis.Window, { durationMs: 1 });
  controllers.push(controller);
  const oldButton = surface.querySelector('button')!;
  dom.dispatchEvent(new dom.CustomEvent('vcd:dev-mode-change', { detail: { active: true } }));
  expect(controller.getState()).toBe('editing');
  body.innerHTML = intro.sections[0].paragraphs.map((p) => `<p>${p}</p>`).join('');
  dom.dispatchEvent(new dom.CustomEvent('vcd:dev-mode-change', { detail: { active: false } }));
  const button = surface.querySelector('button') as HTMLButtonElement;
  expect(button).not.toBe(oldButton);
  button.focus();
  button.click();
  expect(controller.getState()).toBe('dismissing');
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(controller.getState()).toBe('dismissed');
  expect(document.activeElement).toBe(home);
});

test('known action labels discard unsupported interactive markup and attributes', () => {
  const { surface } = fixture(['<span data-home-intro-okay="true" onclick="bad()"><a href="javascript:bad()">View work</a><script>bad()</script> →</span>']);
  const button = surface.querySelector('button')!;
  expect(button.textContent).toBe('View work →');
  expect(button.querySelector('a, script')).toBeNull();
  expect(button.hasAttribute('onclick')).toBe(false);
});

test('only the known action marker survives Save as plain editable text', () => {
  const { body, surface } = fixture();
  body.innerHTML = '<p><button data-home-intro-okay="true" onclick="bad()"><strong>A &amp; B</strong><script>bad()</script></button><span data-home-intro-okay="false">Other</span></p>';
  expect(readParagraphsValue(body)).toEqual(['<span data-home-intro-okay="true">A &amp; B</span>Other']);
  syncHomeIntroActions(surface, false);
  expect(surface.querySelector('span[data-home-intro-okay="false"]')!.tagName).toBe('SPAN');
});

test('server render and Save retain the source label', () => {
  const { body } = fixture(['<span data-home-intro-okay="true">Custom action</span>']);
  expect(readParagraphsValue(body)).toEqual(['<span data-home-intro-okay="true">Custom action</span>']);
  expect(body.querySelector('button')!.textContent).toBe('Custom action');
});

test('View/Edit roundtrip retains a custom source label', () => {
  const { body, surface } = fixture(['<span data-home-intro-okay="true">Custom action</span>']);
  syncHomeIntroActions(surface, true);
  expect(readParagraphsValue(body)).toEqual(['<span data-home-intro-okay="true">Custom action</span>']);
  body.innerHTML = '<p><span data-home-intro-okay="true">Renamed action</span></p>';
  syncHomeIntroActions(surface, false);
  expect(surface.querySelector('button')!.textContent).toBe('Renamed action');
  expect(readParagraphsValue(body)).toEqual(['<span data-home-intro-okay="true">Renamed action</span>']);
});

const introSource = readFileSync(new URL('../../src/components/home/HomeIntroController.astro', import.meta.url), 'utf8');
const skipSeenIntro = introSource.match(/<script is:inline data-astro-rerun>([\s\S]*?)<\/script>/)![1];

test('inline seen check cannot dismiss an intro already activated by its controller', () => {
  const { dom, document, surface, home } = fixture();
  surface.id = 'home-intro-surface';
  surface.dataset.state = 'pending';
  const controller = createHomeIntroController(surface, home, document.documentElement, dom as unknown as globalThis.Window);
  controllers.push(controller);
  expect(dom.sessionStorage.getItem('vcd:home-intro-seen')).toBe('true');
  new Function('document', 'sessionStorage', skipSeenIntro)(document, dom.sessionStorage);
  expect(controller.getState()).toBe('active');
  expect(surface.dataset.state).toBe('active');
  expect(surface.hidden).toBe(false);
});

test('inline seen check still hides a pending intro on a repeat visit', () => {
  const { dom, document, surface } = fixture();
  surface.id = 'home-intro-surface';
  surface.dataset.state = 'pending';
  dom.sessionStorage.setItem('vcd:home-intro-seen', 'true');
  new Function('document', 'sessionStorage', skipSeenIntro)(document, dom.sessionStorage);
  expect(surface.dataset.state).toBe('dismissed');
  expect(surface.hidden).toBe(true);
});
