import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoAssetPicker, type DemoAssetProject } from '../../src/lib/demoAssetPicker';

const projects: DemoAssetProject[] = [
  { slug: 'tools', title: 'Tools', images: [{ src: 'tool.jpg', filename: 'tool.jpg', url: '/images/tool.preview.webp', thumb: '/images/tool.thumb.webp' }] },
  { slug: 'chairs', title: 'Chairs <two>', images: [{ src: 'chair.png', filename: 'chair.png', url: '/images/chair.preview.webp', thumb: '/images/chair.thumb.webp' }] },
];
function setup(catalog = projects, portaled = false) {
  const win = new Window();
  win.document.body.innerHTML = `<button id="opener">Asset manager</button><aside hidden>
    <header data-drag-handle><button data-minimize-toggle data-drag-ignore>Minimize</button><button data-hide-toggle data-drag-ignore>Hide</button></header><div data-overlay-body><div data-asset-projects></div><p data-asset-status></p><div data-asset-grid></div>
    <footer data-asset-footer hidden><p data-asset-count></p><button data-asset-cancel>Cancel</button><button data-asset-select disabled>Select</button></footer></div>
  </aside>`;
  const parent = new Window({ url: 'http://localhost/' });
  if (portaled) {
    parent.document.body.innerHTML = '<div class="project-interactive-demo"><iframe></iframe></div>';
    Object.defineProperty(win, 'frameElement', { value: parent.document.querySelector('iframe') });
    Object.defineProperty(win, 'parent', { value: parent });
  }
  const timers: Array<() => void> = [];
  win.setTimeout = ((callback: () => void) => timers.push(callback)) as typeof win.setTimeout;
  win.clearTimeout = (() => {}) as typeof win.clearTimeout;
  const panel = win.document.querySelector('aside') as unknown as HTMLElement;
  const opener = win.document.querySelector('#opener') as unknown as HTMLElement;
  const api = createDemoAssetPicker(panel, catalog, opener);
  const click = (selector: string) => panel.querySelector<HTMLButtonElement>(selector)!.click();
  return { win, parent, panel, opener, api, click, timers };
}

test('selection resolves the image with accessible state and returns focus to the opener', async () => {
  const h = setup();
  const picked = h.api.open();
  expect(h.panel.hidden).toBe(false);
  expect(h.win.document.activeElement).toBe(h.panel);
  const projectButton = h.panel.querySelector<HTMLButtonElement>('[data-asset-project="tools"]')!;
  expect(projectButton.tabIndex).toBe(0);
  projectButton.focus();
  expect(h.win.document.activeElement).toBe(projectButton);
  expect(h.panel.querySelector('[data-asset-status]')?.textContent).toBe('1 image');
  expect(h.panel.querySelector('img')?.getAttribute('src')).toBe('/images/tool.thumb.webp');
  h.click('[data-asset-src]');
  expect(h.panel.querySelector('[data-asset-src]')?.getAttribute('aria-pressed')).toBe('true');
  h.click('[data-asset-select]');
  expect(await picked).toEqual(projects[0].images[0]);
  expect(h.win.document.activeElement).toBe(h.opener);
  expect(h.panel.inert).toBe(true);
  h.timers.at(-1)!();
  expect(h.panel.hidden).toBe(true);
  h.api.destroy();
});

test('switching project clears selection; cancel and Escape settle without replacing an image', async () => {
  const h = setup();
  const first = h.api.open();
  h.click('[data-asset-src]');
  h.click('[data-asset-project="chairs"]');
  expect(h.panel.querySelector<HTMLButtonElement>('[data-asset-select]')?.disabled).toBe(true);
  expect(h.panel.querySelector('[data-asset-project="chairs"]')?.textContent).toBe('Chairs <two>');
  expect(h.panel.querySelector('two')).toBeNull();
  expect(h.panel.querySelector('img')?.getAttribute('src')).toBe('/images/chair.thumb.webp');
  h.click('[data-asset-cancel]');
  expect(await first).toBeUndefined();
  expect(h.win.document.activeElement).toBe(h.opener);
  const second = h.api.open();
  h.win.document.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  expect(await second).toBeUndefined();
  expect(h.win.document.activeElement).toBe(h.opener);
  h.api.destroy();
});

test('reopen and teardown resolve pending picks; an empty catalog cannot select', async () => {
  const h = setup([]);
  const first = h.api.open();
  const second = h.api.open();
  expect(await first).toBeUndefined();
  expect(h.panel.querySelector<HTMLButtonElement>('[data-asset-select]')?.disabled).toBe(true);
  expect(h.panel.querySelector('[data-asset-status]')?.textContent).toBe('No published images available.');
  h.api.destroy();
  expect(await second).toBeUndefined();
  expect(await h.api.open()).toBeUndefined();
  expect(h.panel.hidden).toBe(true);
});


test('project iframe picker belongs to the page viewport and returns on teardown', async () => {
  const h = setup(projects, true);
  expect(h.panel.ownerDocument).toBe(h.parent.document);
  expect(h.panel.parentNode).toBe(h.parent.document.body);
  const pending = h.api.open();
  expect(h.parent.document.activeElement).toBe(h.panel);
  h.click('[data-minimize-toggle]');
  expect(h.panel.classList.contains('is-minimized')).toBe(true);
  expect(h.panel.querySelector<HTMLElement>('[data-overlay-body]')!.inert).toBe(true);
  h.click('[data-minimize-toggle]');
  expect(h.panel.classList.contains('is-minimized')).toBe(false);
  h.click('[data-asset-src]');
  h.click('[data-asset-select]');
  expect(await pending).toEqual(projects[0].images[0]);
  expect(h.win.document.activeElement).toBe(h.opener);
  const pendingReload = h.api.open();
  h.win.dispatchEvent(new h.win.Event('pagehide'));
  expect(await pendingReload).toBeUndefined();
  expect(h.panel.ownerDocument).toBe(h.win.document);
  expect(h.parent.document.querySelector('aside')).toBeNull();
  expect(h.panel.dataset.devPanelDragInitialized).toBeUndefined();
  h.api.destroy();
});
