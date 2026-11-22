import type { createPageScope } from './pageLifecycle';

export function inspectorWantsShellViewport(stack: string): boolean {
  return /(?:handleMouseMove|constrainPosition)\b[^\n]*agentation/i.test(stack)
    || /\b(?:viewport|onPointerMove|onPointerUp)\b[^\n]*lapse/i.test(stack);
}

export function hoistCanvasChrome(scope: ReturnType<typeof createPageScope>) {
  const cookies = document.cookie.split(';').map((cookie) => cookie.trim());
  if (cookies.includes('vcd-canvas-chrome=0') || window.name !== 'vcd-canvas' || window.parent === window) return;
  const host = window.parent.document;
  const layer = host.querySelector<HTMLElement>('[data-canvas-chrome]');
  if (!layer || !host.documentElement.hasAttribute('data-canvas-shell')) return;
  const root = document.documentElement;
  const hostRoot = host.documentElement;
  const isState = (name: string) => name === 'class' || (name.startsWith('data-') && name !== 'data-canvas-shell');
  const previous = new Map([...hostRoot.attributes].filter((attr) => isState(attr.name)).map((attr) => [attr.name, attr.value]));
  const styles = new Map<Element, Element>();
  const moved = new Map<Element, Comment>();
  const inspectorSelector = '[data-lapse-slot], [data-agentation-toolbar]';
  const chromeSelector = `.dev-text-action-stack, .site-draw-launcher, [data-dev-overlay], .dev-shortcuts-help, ${inspectorSelector}`;
  const agentationWrappers = new Map<Element, { wrapper: HTMLElement; observer: MutationObserver }>();
  const closingToolbars = new WeakSet<Element>();
  const query = document.querySelector.bind(document);
  const queryAll = document.querySelectorAll.bind(document);
  const byId = document.getElementById.bind(document);
  const lookupNames = ['querySelector', 'querySelectorAll', 'getElementById'] as const;
  const lookupDescriptors = lookupNames.map((name) => Object.getOwnPropertyDescriptor(document, name));
  const bridged = new WeakSet<Event>();
  const pointers = new Set<number>();
  let mousePressed = false;
  let lastPointerTarget: Node | null = null;
  let active = false;
  let stopped = false;

  const mirrorStyles = () => {
    const sources = new Set(queryAll('style, link[rel="stylesheet"]'));
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
  const hostWindow = host.defaultView as unknown as Record<string, unknown>;
  const frameWindow = window as unknown as Record<string, unknown>;
  const realmNames = Object.getOwnPropertyNames(window).filter((name) =>
    /^(Node|Element|Text|DocumentFragment|(HTML|SVG)\w*Element)$/.test(name)
    && typeof frameWindow[name] === 'function' && typeof hostWindow[name] === 'function');
  const hasInstance = Function.prototype[Symbol.hasInstance];
  const shareRealms = (share: boolean) => {
    for (const name of realmNames) {
      const pair = [frameWindow[name], hostWindow[name]] as [object, object];
      pair.forEach((type, index) => {
        if (!share) { delete (type as Record<symbol, unknown>)[Symbol.hasInstance]; return; }
        const other = pair[1 - index];
        Object.defineProperty(type, Symbol.hasInstance, { configurable: true,
          value: (value: unknown) => hasInstance.call(type, value) || hasInstance.call(other, value) });
      });
    }
  };
  const viewportProperties = [
    { target: window, name: 'innerWidth', shell: () => host.defaultView!.innerWidth },
    { target: window, name: 'innerHeight', shell: () => host.defaultView!.innerHeight },
    { target: root, name: 'clientWidth', shell: () => hostRoot.clientWidth },
    { target: root, name: 'clientHeight', shell: () => hostRoot.clientHeight },
  ].map(({ target, name, shell }) => {
    const own = Object.getOwnPropertyDescriptor(target, name);
    let native = own;
    let prototype = Object.getPrototypeOf(target);
    while (!native && prototype) {
      native = Object.getOwnPropertyDescriptor(prototype, name);
      prototype = Object.getPrototypeOf(prototype);
    }
    const getter = native?.get;
    const read = getter ? () => getter.call(target) : () => native?.value;
    return { target, name, shell, own, read };
  });
  let viewportPatched = false;
  const restoreInspectorViewport = () => {
    if (!viewportPatched) return;
    for (const { target, name, own } of viewportProperties) {
      if (own) Object.defineProperty(target, name, own);
      else Reflect.deleteProperty(target, name);
    }
    viewportPatched = false;
  };
  const syncInspectorViewport = () => {
    const hoisted = active && [...moved.keys()].some((node) => node.matches(inspectorSelector)
      && node.isConnected && node.ownerDocument === host);
    if (!hoisted) { restoreInspectorViewport(); return; }
    if (viewportPatched) return;
    if (viewportProperties.some(({ own }) => own && !own.configurable)) return;
    viewportPatched = true;
    try {
      for (const { target, name, shell, read } of viewportProperties) {
        Object.defineProperty(target, name, { configurable: true, get: () =>
          inspectorWantsShellViewport(new Error().stack ?? '') ? shell() : read() });
      }
    } catch {
      restoreInspectorViewport();
    }
  };
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
    bridge(event);
  };
  const eventTypes = ['click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'pointercancel',
    'mousedown', 'mouseup', 'keydown', 'keyup', 'input', 'change', 'focusin', 'focusout', 'wheel'];
  for (const type of eventTypes) layer.addEventListener(type, onLayerEvent);
  const rememberPointer = (event: PointerEvent) => {
    lastPointerTarget = event.target as Node | null;
    if (owns(event.target)) {
      pointers.add(event.pointerId);
      if (!event.pointerType || event.pointerType === 'mouse') mousePressed = true;
    }
  };
  const rememberMouse = (event: MouseEvent) => { if (owns(event.target)) mousePressed = true; };
  const mouseDragEvent = (event: MouseEvent) => {
    if (!mousePressed) return;
    if (event.type === 'mousemove' || !owns(event.target)) bridge(event);
    if (event.type === 'mouseup') { mousePressed = false; pointers.clear(); }
  };
  const dragEvent = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    if (event.type === 'pointermove' || !owns(event.target)) bridge(event);
    if (event.type !== 'pointermove') pointers.delete(event.pointerId);
    if (event.type === 'pointercancel') mousePressed = false;
  };
  host.addEventListener('mousedown', rememberMouse, true);
  for (const type of ['mousemove', 'mouseup']) host.addEventListener(type, mouseDragEvent, true);
  host.addEventListener('pointerdown', rememberPointer, true);
  document.addEventListener('pointerdown', rememberPointer, true);
  for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const) host.addEventListener(type, dragEvent, true);
  const restoreNode = (node: Element) => {
    const placeholder = moved.get(node);
    if (!placeholder) return;
    moved.delete(node);
    if (node.isConnected && placeholder.isConnected) placeholder.replaceWith(node);
    else { node.remove(); placeholder.remove(); }
    const agentation = agentationWrappers.get(node);
    agentation?.observer.disconnect();
    agentation?.wrapper.remove();
    agentationWrappers.delete(node);
    syncInspectorViewport();
    notifyMoved();
  };
  const beforeAgentationClose = () => {
    for (const node of agentationWrappers.keys()) {
      closingToolbars.add(node);
      restoreNode(node);
    }
  };
  scope.listen(window, 'vcd:agentation-before-close', beforeAgentationClose);
  const restore = () => {
    active = false;
    pointers.clear();
    mousePressed = false;
    lastPointerTarget = null;
    restoreLookups();
    restoreInspectorViewport();
    shareRealms(false);
    for (const node of moved.keys()) restoreNode(node);
    for (const clone of styles.values()) clone.remove();
    styles.clear();
    for (const attr of [...hostRoot.attributes]) if (isState(attr.name)) hostRoot.removeAttribute(attr.name);
    for (const [name, value] of previous) hostRoot.setAttribute(name, value);
  };
  const move = (node: Element) => {
    if (!node.isConnected || closingToolbars.has(node) || node.matches('[data-reddit-board-height-panel]') || moved.has(node) || layer.contains(node)) return;
    const focused = node.contains(node.ownerDocument.activeElement) ? node.ownerDocument.activeElement as HTMLElement : null;
    const open = node.hasAttribute('popover') && node.matches(':popover-open');
    const placeholder = document.createComment('canvas chrome');
    node.before(placeholder);
    moved.set(node, placeholder);
    const agentationRoot = node.matches('[data-agentation-toolbar]') ? node.closest<HTMLElement>('[data-agentation-root]') : null;
    if (agentationRoot) {
      const wrapper = host.createElement('div');
      const mirrorAgentation = () => {
        for (const attr of [...wrapper.attributes]) if (attr.name.startsWith('data-agentation-')) wrapper.removeAttribute(attr.name);
        for (const attr of agentationRoot.attributes) if (attr.name.startsWith('data-agentation-')) wrapper.setAttribute(attr.name, attr.value);
        wrapper.style.cssText = 'display: contents';
        for (const property of Array.from(agentationRoot.style)) if (property.startsWith('--')) {
          wrapper.style.setProperty(property, agentationRoot.style.getPropertyValue(property), agentationRoot.style.getPropertyPriority(property));
        }
      };
      mirrorAgentation();
      const observer = new MutationObserver(mirrorAgentation);
      observer.observe(agentationRoot, { attributes: true });
      agentationWrappers.set(node, { wrapper, observer });
      layer.append(wrapper);
      wrapper.append(node);
    } else layer.append(node);
    if (open) (node as HTMLElement).showPopover();
    focused?.focus({ preventScroll: true });
    syncInspectorViewport();
    notifyMoved();
  };
  const hoist = () => {
    for (const node of queryAll(chromeSelector)) {
      if (node.matches('.dev-shortcuts-help') && window.getComputedStyle(node).position !== 'fixed') continue;
      move(node);
    }
  };
  const sync = () => {
    if (stopped) return;
    if (!root.classList.contains('is-dev-mode')) { if (active) restore(); return; }
    if (!active) { patchLookups(); shareRealms(true); }
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
    if (records.some((record) => [...record.addedNodes].some((node) => node instanceof window.Element && node.matches('style, link[rel="stylesheet"]')))) mirrorStyles();
    for (const record of records) {
      if (record.target !== document.body || !fromChrome) continue;
      for (const node of record.addedNodes) {
        if (!(node instanceof window.Element) || node.parentNode !== document.body) continue;
        if (node.matches('[popover]:popover-open')) move(node);
      }
    }
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (!(added instanceof window.Element)) continue;
        const candidates = [added, ...added.querySelectorAll(chromeSelector)];
        for (const node of candidates) {
          if (!node.matches(chromeSelector)) continue;
          if (node.matches('.dev-shortcuts-help') && window.getComputedStyle(node).position !== 'fixed') continue;
          move(node);
        }
      }
    }
    if (records.some((record) => record.removedNodes.length)) {
      for (const [node, placeholder] of moved) if (!placeholder.isConnected || !node.isConnected) restoreNode(node);
    }
    syncInspectorViewport();
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
    restoreNode(node);
  };
  document.addEventListener('toggle', onToggle, true);
  layer.addEventListener('toggle', onToggle, true);
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  bodyObserver.observe(layer, { childList: true, subtree: true });
  const cleanup = () => {
    stopped = true;
    stateObserver.disconnect();
    headObserver.disconnect();
    bodyObserver.disconnect();
    if (active) restore();
    restoreInspectorViewport();
    for (const type of eventTypes) layer.removeEventListener(type, onLayerEvent);
    layer.removeEventListener('toggle', onToggle, true);
    host.removeEventListener('mousedown', rememberMouse, true);
    for (const type of ['mousemove', 'mouseup']) host.removeEventListener(type, mouseDragEvent, true);
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
