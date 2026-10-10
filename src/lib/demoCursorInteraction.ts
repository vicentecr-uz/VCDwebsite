type Point = { x: number; y: number };
type CursorMode = 'arrow' | 'pointer' | 'grab' | 'grabbing';

interface DemoCursorInteractionOptions {
  root: HTMLElement;
  iframe?: HTMLIFrameElement;
}

const isDisabled = (element: HTMLElement) => element.hasAttribute('disabled')
  || element.getAttribute('aria-disabled') === 'true'
  || Boolean((element as HTMLButtonElement).disabled);

export function createDemoCursorInteraction({ root, iframe }: DemoCursorInteractionOptions) {
  const document = root.ownerDocument;
  let hovered: HTMLElement | undefined;
  let pressed = false;

  const clearHover = () => {
    hovered?.removeAttribute('data-demo-hover');
    hovered?.removeAttribute('data-demo-pressed');
    hovered = undefined;
  };
  const withinRoot = (element: Element) => root.contains(element)
    || element === iframe
    || Boolean(iframe?.contentDocument?.documentElement.contains(element));
  const nearestControl = (element: Element | null): HTMLElement | undefined => {
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
      if (current.nodeType === 1 && current.matches('button, a')) return isDisabled(current as HTMLElement) ? undefined : current as HTMLElement;
      if (current === root) break;
    }
    return undefined;
  };
  const hitAt = (point: Point): Element | null => {
    const hit = document.elementFromPoint?.(point.x, point.y) ?? null;
    if (iframe && hit === iframe && iframe.contentDocument && iframe.contentWindow) {
      try {
        const rect = iframe.getBoundingClientRect();
        const x = (point.x - rect.left) * iframe.offsetWidth / Math.max(1, rect.width);
        const y = (point.y - rect.top) * iframe.offsetHeight / Math.max(1, rect.height);
        return iframe.contentDocument.elementFromPoint?.(x, y) ?? null;
      } catch { return hit; }
    }
    return hit;
  };
  const modeForElement = (hit: Element | null): CursorMode => {
    if (!hit || !withinRoot(hit)) return 'arrow';
    const owner = hit.closest('button, a') as HTMLElement | null;
    if (owner && isDisabled(owner)) return 'arrow';
    const cursor = hit.ownerDocument.defaultView?.getComputedStyle(hit).cursor;
    if (cursor === 'pointer') return 'pointer';
    if (cursor === 'grab') return 'grab';
    if (cursor === 'grabbing') return 'grabbing';
    return 'arrow';
  };
  const update = (point: Point, visible = true): CursorMode => {
    if (!visible) { pressed = false; clearHover(); return 'arrow'; }
    const hit = hitAt(point);
    const next = hit && withinRoot(hit) ? nearestControl(hit) : undefined;
    if (next !== hovered) {
      hovered?.removeAttribute('data-demo-hover');
      hovered?.removeAttribute('data-demo-pressed');
      hovered = next;
      hovered?.setAttribute('data-demo-hover', 'true');
      if (pressed) hovered?.setAttribute('data-demo-pressed', 'true');
    }
    return modeForElement(hit);
  };
  return {
    update,
    press() { if (hovered) { pressed = true; hovered.setAttribute('data-demo-pressed', 'true'); } },
    release() { pressed = false; hovered?.removeAttribute('data-demo-pressed'); },
    clear() { pressed = false; clearHover(); },
    destroy() { pressed = false; clearHover(); },
  };
}
