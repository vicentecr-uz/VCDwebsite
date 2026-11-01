/** Keep presentation-only input indicators outside demo content and its iframe. */
export function createDemoIndicatorLayer(anchor: HTMLElement, coordinates: 'element' | 'viewport' = 'viewport') {
  const source = anchor.ownerDocument;
  const win = source.defaultView!;
  let frame: HTMLIFrameElement | null = null;
  try {
    // Only the site's same-origin demo embeds can project onto their parent page.
    const candidate = win.frameElement as HTMLIFrameElement | null;
    if (candidate?.closest('project-demo-content')) frame = candidate;
  } catch { /* A foreign embed keeps its indicators in its own document. */ }
  const document = frame?.ownerDocument ?? source;
  const parent = document.defaultView!;
  const layer = document.createElement('div');
  layer.className = 'demo-indicator-layer';
  layer.setAttribute('aria-hidden', 'true');
  const space = document.createElement('div');
  space.className = 'demo-indicator-space';
  layer.append(space);
  document.body.append(layer);
  let destroyed = false;

  const sync = () => {
    if (destroyed) return;
    const bounds = anchor.getBoundingClientRect();
    const frameBounds = frame?.getBoundingClientRect();
    const sx = frameBounds ? frameBounds.width / (frame!.offsetWidth || 1) : 1;
    const sy = frameBounds ? frameBounds.height / (frame!.offsetHeight || 1) : 1;
    const local = coordinates === 'element';
    const x = (frameBounds?.left ?? 0) + (local ? bounds.left * sx : 0);
    const y = (frameBounds?.top ?? 0) + (local ? bounds.top * sy : 0);
    const scaleX = sx * (local ? bounds.width / (anchor.offsetWidth || 1) : 1);
    const scaleY = sy * (local ? bounds.height / (anchor.offsetHeight || 1) : 1);
    space.style.transform = `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`;
    const visibleBounds = frameBounds ?? bounds;
    layer.hidden = !anchor.isConnected || !bounds.width || !bounds.height
      || visibleBounds.bottom <= 0 || visibleBounds.top >= parent.innerHeight
      || visibleBounds.right <= 0 || visibleBounds.left >= parent.innerWidth
      || Boolean(frame?.closest('[data-demo-loading]'));
    const styles = win.getComputedStyle(anchor);
    for (const token of ['--ss-cursor-size', '--ss-cursor-line', '--ss-cursor-edge', '--ss-accent', '--ss-text-strong']) {
      space.style.setProperty(token, styles.getPropertyValue(token));
    }
    for (const key of ['theme', 'palette', 'mark', 'placing', 'still', 'offscreen']) {
      if (anchor.dataset[key] !== undefined) space.dataset[key] = anchor.dataset[key];
      else delete space.dataset[key];
    }
  };
  const resize = new win.ResizeObserver(sync);
  resize.observe(anchor);
  if (frame) resize.observe(frame);
  const mutations = new win.MutationObserver(sync);
  mutations.observe(anchor, { attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-palette', 'data-mark', 'data-placing', 'data-still', 'data-offscreen'] });
  if (frame?.parentElement) mutations.observe(frame.parentElement, { attributes: true, attributeFilter: ['data-demo-loading'] });
  const windows = new Set([win, parent]);
  for (const window of windows) {
    window.addEventListener('scroll', sync, { capture: true, passive: true });
    window.addEventListener('resize', sync);
  }
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    resize.disconnect();
    mutations.disconnect();
    for (const window of windows) {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    }
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', sync);
    document.removeEventListener('astro:before-swap', destroy);
    layer.remove();
  };
  const onPageHide = (event: PageTransitionEvent) => { if (event.persisted) layer.hidden = true; else destroy(); };
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', sync);
  document.addEventListener('astro:before-swap', destroy);
  sync();
  return { element: space, sync, destroy };
}
