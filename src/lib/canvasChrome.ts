import type { createPageScope } from './pageLifecycle';

export function hoistCanvasChrome(scope: ReturnType<typeof createPageScope>) {
  const cookies = document.cookie.split(';').map((cookie) => cookie.trim());
  if (!cookies.includes('vcd-canvas=1') || !cookies.includes('vcd-canvas-chrome=1')
    || window.name !== 'vcd-canvas' || window.parent === window) return;
  const host = window.parent.document;
  const layer = host.querySelector<HTMLElement>('[data-canvas-chrome]');
  if (!layer || !host.documentElement.hasAttribute('data-canvas-shell')) return;
  const root = document.documentElement;
  const hostRoot = host.documentElement;
  const isState = (name: string) => name === 'class' || (name.startsWith('data-') && name !== 'data-canvas-shell');
  const previous = new Map([...hostRoot.attributes].filter((attr) => isState(attr.name)).map((attr) => [attr.name, attr.value]));
  const styles = new Map<Element, Element>();
  const moved = new Map<Element, Comment>();
  let active = false;
  let stopped = false;

  const mirrorStyles = () => {
    const sources = new Set(document.head.querySelectorAll('style, link[rel="stylesheet"]'));
    for (const [source, clone] of styles) {
      if (!sources.has(source)) { clone.remove(); styles.delete(source); }
    }
    for (const source of sources) {
      let clone = styles.get(source);
      if (!clone) {
        clone = source.cloneNode(true) as Element;
        styles.set(source, clone);
      }
      for (const attr of [...clone.attributes]) if (!source.hasAttribute(attr.name)) clone.removeAttribute(attr.name);
      for (const attr of source.attributes) clone.setAttribute(attr.name, attr.value);
      clone.setAttribute('data-canvas-mirrored', '');
      if (clone.textContent !== source.textContent) clone.textContent = source.textContent;
      host.head.append(clone);
    }
  };
  const mirrorState = () => {
    for (const attr of [...hostRoot.attributes]) {
      if (!isState(attr.name) || root.hasAttribute(attr.name)) continue;
      const value = previous.get(attr.name);
      if (value === undefined) hostRoot.removeAttribute(attr.name);
      else hostRoot.setAttribute(attr.name, value);
    }
    for (const attr of root.attributes) if (isState(attr.name)) hostRoot.setAttribute(attr.name, attr.value);
  };
  const restore = () => {
    for (const [node, placeholder] of moved) { placeholder.replaceWith(node); }
    moved.clear();
    for (const clone of styles.values()) clone.remove();
    styles.clear();
    for (const attr of [...hostRoot.attributes]) if (isState(attr.name)) hostRoot.removeAttribute(attr.name);
    for (const [name, value] of previous) hostRoot.setAttribute(name, value);
    active = false;
  };
  const hoist = () => {
    for (const node of document.querySelectorAll('.dev-text-action-stack, .site-draw-launcher')) {
      const placeholder = document.createComment('canvas chrome');
      node.before(placeholder);
      moved.set(node, placeholder);
      layer.append(node);
    }
  };
  const sync = () => {
    if (stopped) return;
    if (!root.classList.contains('is-dev-mode')) { if (active) restore(); return; }
    active = true;
    mirrorState();
    mirrorStyles();
    hoist();
  };
  const stateObserver = new MutationObserver(sync);
  stateObserver.observe(root, { attributes: true });
  const headObserver = new MutationObserver(() => { if (active) mirrorStyles(); });
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
  const bodyObserver = new MutationObserver(() => { if (active) hoist(); });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  const cleanup = () => {
    stopped = true;
    stateObserver.disconnect();
    headObserver.disconnect();
    bodyObserver.disconnect();
    if (active) restore();
  };
  scope.listen(window, 'pagehide', cleanup);
  scope.listen(document, 'astro:before-swap', cleanup);
  scope.add(cleanup);
  sync();
}
