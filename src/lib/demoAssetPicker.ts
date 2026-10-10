import { createDevPanelDrag } from './devPanelDrag';
import { createDevPanelCollapse } from './devPanelCollapse';

export type DemoAsset = { src: string; filename: string; url: string; thumb: string };
export type DemoAssetProject = { slug: string; title: string; images: DemoAsset[] };

export function createDemoAssetPicker(panel: HTMLElement, projects: DemoAssetProject[], opener: HTMLElement) {
  panel.tabIndex = -1;
  const sourceWindow = panel.ownerDocument.defaultView!;
  const sourceParent = panel.parentNode!;
  const sourceNext = panel.nextSibling;
  // Same-origin project demos share the page viewport; standalone previews keep their own.
  if (sourceWindow.frameElement?.closest('.project-interactive-demo')) {
    sourceWindow.parent.document.body.append(panel);
  }
  const doc = panel.ownerDocument;
  const win = doc.defaultView!;
  const lifecycle = new win.AbortController();
  const { signal } = lifecycle;
  const projectsEl = panel.querySelector<HTMLElement>('[data-asset-projects]')!;
  const grid = panel.querySelector<HTMLElement>('[data-asset-grid]')!;
  const status = panel.querySelector<HTMLElement>('[data-asset-status]')!;
  const count = panel.querySelector<HTMLElement>('[data-asset-count]')!;
  const select = panel.querySelector<HTMLButtonElement>('[data-asset-select]')!;
  let project = projects[0];
  let selected: DemoAsset | undefined;
  let resolvePick: ((asset: DemoAsset | undefined) => void) | undefined;
  let hideTimer = 0;
  const stopDragging = createDevPanelDrag(panel);
  const collapse = createDevPanelCollapse(panel);

  const syncSelection = () => {
    select.disabled = !selected;
    count.textContent = selected ? '1 selected' : 'Select one image';
    grid.querySelectorAll<HTMLButtonElement>('[data-asset-src]').forEach((button) => {
      const active = button.dataset.assetSrc === selected?.src;
      button.setAttribute('aria-pressed', String(active));
      button.parentElement?.classList.toggle('is-selected', active);
    });
  };
  const renderGrid = () => {
    grid.replaceChildren();
    selected = undefined;
    const images = project?.images ?? [];
    status.textContent = images.length ? `${images.length} ${images.length === 1 ? 'image' : 'images'}` : 'No published images available.';
    for (const asset of images) {
      const card = doc.createElement('div');
      card.className = 'dev-asset-manager__card';
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'dev-asset-manager__thumb';
      button.dataset.assetSrc = asset.src;
      button.setAttribute('aria-label', asset.filename);
      const image = doc.createElement('img');
      image.src = asset.thumb;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      button.append(image);
      card.append(button);
      grid.append(card);
    }
    projectsEl.querySelectorAll<HTMLButtonElement>('[data-asset-project]').forEach((button) => {
      const active = button.dataset.assetProject === project?.slug;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    grid.scrollTop = 0;
    syncSelection();
  };
  for (const item of projects) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'dev-asset-manager__project';
    button.dataset.assetProject = item.slug;
    const label = doc.createElement('span');
    label.className = 'dev-asset-manager__project-label';
    label.textContent = item.title;
    button.append(label);
    projectsEl.append(button);
  }
  projectsEl.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-asset-project]');
    const next = projects.find((item) => item.slug === button?.dataset.assetProject);
    if (!next || next === project) return;
    project = next;
    renderGrid();
  }, { signal });
  grid.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-asset-src]');
    if (!button) return;
    const next = project?.images.find((asset) => asset.src === button.dataset.assetSrc);
    selected = next === selected ? undefined : next;
    syncSelection();
  }, { signal });
  const close = (asset?: DemoAsset, restoreFocus = true) => {
    const resolve = resolvePick;
    resolvePick = undefined;
    panel.classList.remove('is-dev-overlay-open');
    panel.inert = true;
    win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => { panel.hidden = true; }, 180);
    if (resolve && restoreFocus) opener.focus({ preventScroll: true });
    resolve?.(asset);
  };
  panel.querySelector('[data-asset-footer]')?.removeAttribute('hidden');
  panel.querySelector('[data-asset-cancel]')?.addEventListener('click', () => close(), { signal });
  panel.querySelector('[data-hide-toggle]')?.addEventListener('click', () => close(), { signal });
  panel.querySelector('[data-minimize-toggle]')?.addEventListener('click', () => collapse.set(!panel.classList.contains('is-minimized')), { signal });
  select.addEventListener('click', () => { if (selected) close(selected); }, { signal });
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !resolvePick) return;
    event.preventDefault();
    close();
  }, { signal });
  const destroy = () => {
    if (signal.aborted) return;
    close(undefined, false);
    lifecycle.abort();
    win.clearTimeout(hideTimer);
    stopDragging();
    collapse.destroy();
    panel.hidden = true;
    projectsEl.replaceChildren();
    grid.replaceChildren();
    if (panel.parentNode !== sourceParent) sourceParent.insertBefore(panel, sourceNext?.parentNode === sourceParent ? sourceNext : null);
  };
  sourceWindow.addEventListener('pagehide', destroy, { signal });
  renderGrid();
  return {
    open: () => new Promise<DemoAsset | undefined>((resolve) => {
      if (signal.aborted) { resolve(undefined); return; }
      resolvePick?.(undefined);
      resolvePick = resolve;
      selected = undefined;
      syncSelection();
      win.clearTimeout(hideTimer);
      panel.hidden = false;
      panel.inert = false;
      if (panel.classList.contains('is-minimized')) collapse.set(false, false);
      panel.getBoundingClientRect();
      panel.classList.add('is-dev-overlay-open');
      panel.focus({ preventScroll: true });
    }),
    destroy,
  };
}
