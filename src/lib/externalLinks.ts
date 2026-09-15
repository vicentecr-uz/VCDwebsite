export function bindExternalLinks() {
  const defaults = new WeakSet<HTMLAnchorElement>();

  const apply = (anchor: HTMLAnchorElement) => {
    if (defaults.has(anchor)) {
      if (anchor.target !== '_blank') {
        defaults.delete(anchor);
        return;
      }
      anchor.removeAttribute('target');
      defaults.delete(anchor);
    }
    if (anchor.hasAttribute('target') || anchor.hasAttribute('download')) return;
    if (!['http:', 'https:'].includes(anchor.protocol) || anchor.origin === window.location.origin) return;
    defaults.add(anchor);
    anchor.target = '_blank';
    anchor.relList.add('noopener', 'noreferrer');
  };

  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(apply);
  const onActivate = (event: Event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (anchor instanceof HTMLAnchorElement) apply(anchor);
  };
  for (const type of ['click', 'auxclick', 'contextmenu']) {
    document.addEventListener(type, onActivate, true);
  }
}
