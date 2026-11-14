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
  const query = document.querySelector.bind(document);
  const queryAll = document.querySelectorAll.bind(document);
  const byId = document.getElementById.bind(document);
  const lookupNames = ['querySelector', 'querySelectorAll', 'getElementById'] as const;
  const lookupDescriptors = lookupNames.map((name) => Object.getOwnPropertyDescriptor(document, name));
  const bridged = new WeakSet<Event>();
  const pointers = new Set<number>();
  let lastPointerTarget: Node | null = null;
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
  const notifyMoved = () => window.dispatchEvent(new window.CustomEvent('vcd:canvas-chrome-moved'));
  const restoreLookups = () => {
    lookupNames.forEach((name, index) => {
      const descriptor = lookupDescriptors[index];
      if (descriptor) Object.defineProperty(document, name, descriptor);
      else delete (document as unknown as Record<string, unknown>)[name];
    });
  };
  const patchLookups = () => {
    Object.defineProperties(document, {
      querySelector: { configurable: true, value: (selector: string) => query(selector) ?? layer.querySelector(selector) },
      getElementById: { configurable: true, value: (id: string) => byId(id)
        ?? [...layer.querySelectorAll('[id]')].find((node) => node.id === id) ?? null },
      querySelectorAll: { configurable: true, value: (selector: string) => {
        const nodes = [...queryAll(selector), ...layer.querySelectorAll(selector)];
        // A static NodeList-shaped collection retains item() as well as indexed/iterable callers.
        const list = Object.assign(Object.create(null), nodes, {
          length: nodes.length,
          item: (index: number) => nodes[index] ?? null,
          forEach: (callback: (node: Element, index: number, list: unknown) => void, thisArg?: unknown) => {
            nodes.forEach((node, index) => callback.call(thisArg, node, index, list));
          },
          entries: () => nodes.entries(), keys: () => nodes.keys(), values: () => nodes.values(),
          [Symbol.iterator]: () => nodes[Symbol.iterator](),
        });
        return list;
      } },
    });
  };
  const owns = (target: EventTarget | null) => !!target && 'nodeType' in target
    && [...moved.keys()].some((node) => node.contains(target as Node));
  const bridge = (event: Event) => {
    if (!active || bridged.has(event)) return;
    const originalTarget = event.target;
    const path = event.composedPath();
    const init: Record<string, unknown> = { bubbles: true, cancelable: event.cancelable, composed: event.composed };
    for (const key of ['view', 'detail', 'screenX', 'screenY', 'clientX', 'clientY', 'button', 'buttons',
      'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'relatedTarget', 'movementX', 'movementY',
      'altitudeAngle', 'azimuthAngle', 'pointerId', 'width', 'height', 'pressure', 'tangentialPressure', 'tiltX', 'tiltY', 'twist', 'pointerType', 'isPrimary',
      'key', 'code', 'location', 'repeat', 'isComposing', 'keyCode', 'charCode', 'which',
      'data', 'inputType', 'dataTransfer', 'deltaX', 'deltaY', 'deltaZ', 'deltaMode']) {
      if (key in event) init[key] = (event as unknown as Record<string, unknown>)[key];
    }
    const constructors = window as unknown as Record<string, new (type: string, init: object) => Event>;
    const Constructor = constructors[event.constructor.name] ?? window.Event;
    const clone = new Constructor(event.type, init);
    Object.defineProperties(clone, {
      target: { value: originalTarget }, srcElement: { value: originalTarget },
      composedPath: { configurable: true, value: () => path },
    });
    bridged.add(clone);
    document.body.dispatchEvent(clone);
    if (clone.defaultPrevented && event.cancelable) event.preventDefault();
  };
  const onLayerEvent = (event: Event) => {
    if (!owns(event.target)) return;
    if (event.type === 'pointerdown') pointers.add((event as PointerEvent).pointerId);
    bridge(event);
  };
  const eventTypes = ['click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'pointercancel',
    'mousedown', 'mouseup', 'keydown', 'keyup', 'input', 'change', 'focusin', 'focusout', 'wheel'];
  for (const type of eventTypes) layer.addEventListener(type, onLayerEvent);
  const rememberPointer = (event: PointerEvent) => { lastPointerTarget = event.target as Node | null; };
  const dragEvent = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    if (event.type === 'pointermove' || !owns(event.target)) bridge(event);
    if (event.type !== 'pointermove') pointers.delete(event.pointerId);
  };
  host.addEventListener('pointerdown', rememberPointer, true);
  document.addEventListener('pointerdown', rememberPointer, true);
  for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const) host.addEventListener(type, dragEvent, true);
  const restore = () => {
    active = false;
    pointers.clear();
    lastPointerTarget = null;
    restoreLookups();
    for (const [node, placeholder] of moved) {
      if (node.isConnected) placeholder.replaceWith(node);
      else placeholder.remove();
      moved.delete(node);
      notifyMoved();
    }
    moved.clear();
    for (const clone of styles.values()) clone.remove();
    styles.clear();
    for (const attr of [...hostRoot.attributes]) if (isState(attr.name)) hostRoot.removeAttribute(attr.name);
    for (const [name, value] of previous) hostRoot.setAttribute(name, value);
  };
  const move = (node: Element) => {
    if (moved.has(node) || layer.contains(node)) return;
    const focused = node.contains(node.ownerDocument.activeElement) ? node.ownerDocument.activeElement as HTMLElement : null;
    const open = node.hasAttribute('popover') && node.matches(':popover-open');
    const placeholder = document.createComment('canvas chrome');
    node.before(placeholder);
    moved.set(node, placeholder);
    layer.append(node);
    if (open) (node as HTMLElement).showPopover();
    focused?.focus({ preventScroll: true });
    notifyMoved();
  };
  const hoist = () => {
    for (const node of queryAll('.dev-text-action-stack, .site-draw-launcher, [data-dev-overlay], .dev-shortcuts-help')) {
      if (node.matches('.dev-shortcuts-help') && window.getComputedStyle(node).position !== 'fixed') continue;
      move(node);
    }
  };
  const sync = () => {
    if (stopped) return;
    if (!root.classList.contains('is-dev-mode')) { if (active) restore(); return; }
    if (!active) patchLookups();
    active = true;
    mirrorState();
    mirrorStyles();
    hoist();
  };
  const stateObserver = new MutationObserver(sync);
  stateObserver.observe(root, { attributes: true });
  const headObserver = new MutationObserver(() => { if (active) mirrorStyles(); });
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
  const bodyObserver = new MutationObserver((records) => {
    if (!active) return;
    const fromChrome = owns(host.activeElement) || owns(lastPointerTarget);
    for (const record of records) {
      if (record.target !== document.body || !fromChrome) continue;
      for (const node of record.addedNodes) {
        if (!(node instanceof window.Element) || node.parentNode !== document.body) continue;
        // Base UI's React-owned portal cannot be reparented safely: React removes it from body on unmount.
        if (node.matches('[popover]:popover-open')) move(node);
      }
    }
    hoist();
  });
  const onToggle = (event: Event) => {
    const node = event.target as HTMLElement;
    if (!active || !node.hasAttribute('popover')) return;
    if ((event as ToggleEvent).newState === 'open' && node.parentNode === document.body
      && (owns(host.activeElement) || owns(lastPointerTarget))) {
      move(node);
      return;
    }
    const placeholder = moved.get(node);
    if (!placeholder || (event as ToggleEvent).newState !== 'closed') return;
    moved.delete(node);
    placeholder.replaceWith(node);
    notifyMoved();
  };
  document.addEventListener('toggle', onToggle, true);
  layer.addEventListener('toggle', onToggle, true);
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  const cleanup = () => {
    stopped = true;
    stateObserver.disconnect();
    headObserver.disconnect();
    bodyObserver.disconnect();
    if (active) restore();
    for (const type of eventTypes) layer.removeEventListener(type, onLayerEvent);
    layer.removeEventListener('toggle', onToggle, true);
    host.removeEventListener('pointerdown', rememberPointer, true);
    document.removeEventListener('pointerdown', rememberPointer, true);
    document.removeEventListener('toggle', onToggle, true);
    for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const) host.removeEventListener(type, dragEvent, true);
  };
  scope.listen(window, 'pagehide', cleanup);
  scope.listen(document, 'astro:before-swap', cleanup);
  scope.add(cleanup);
  sync();
}
