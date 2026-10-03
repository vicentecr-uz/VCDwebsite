export function copyAttributes(current: Element, incoming: Element) {
  for (const { name } of [...current.attributes]) current.removeAttribute(name);
  for (const { name, value } of [...incoming.attributes]) current.setAttribute(name, value);
}

/** Retain the shell and every ancestor in place: moving them restarts CSS animations in Safari. */
function replaceAround(current: Element, incoming: Element, retained: Map<Element, Element>) {
  for (const child of [...current.childNodes]) {
    if (!(child instanceof Element) || !retained.has(child)) child.remove();
  }
  let previous: Node | null = null;
  for (const child of [...incoming.childNodes]) {
    const existing = [...retained].find(([, replacement]) => replacement === child)?.[0];
    if (existing) previous = existing;
    else {
      current.insertBefore(child, previous ? previous.nextSibling : current.firstChild);
      previous = child;
    }
  }
}

export function persistentPageParts(doc: Document) {
  const wrapper = doc.getElementById('site-wrapper');
  const page = wrapper?.querySelector<HTMLElement>(':scope > [data-page-shell]');
  const header = page?.querySelector<HTMLElement>(':scope > .site-header-slot');
  const backdrop = page?.querySelector<HTMLElement>(':scope > .header-menu-backdrop');
  const overlay = doc.getElementById('transition-overlay');
  return wrapper && page && header && backdrop && overlay ? { wrapper, page, header, backdrop, overlay } : null;
}

export function swapPageContent(current: Document, incoming: Document) {
  const old = persistentPageParts(current);
  const next = persistentPageParts(incoming);
  if (!old || !next) throw new Error('Persistent page shell is missing');
  copyAttributes(current.body, incoming.body);
  const timing = ['duration', 'delay', 'easing'].map((name) => {
    const property = `--header-menu-surface-${name}`;
    return [property, old.wrapper.style.getPropertyValue(property)];
  });
  copyAttributes(old.wrapper, next.wrapper);
  for (const [property, value] of timing) if (value) old.wrapper.style.setProperty(property, value);
  copyAttributes(old.page, next.page);
  replaceAround(current.body, incoming.body, new Map([[old.wrapper, next.wrapper], [old.overlay, next.overlay]]));
  replaceAround(old.wrapper, next.wrapper, new Map([[old.page, next.page]]));
  replaceAround(old.page, next.page, new Map([[old.header, next.header], [old.backdrop, next.backdrop]]));
}
