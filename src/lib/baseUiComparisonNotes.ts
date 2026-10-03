export function initComparisonNotes() {
  const controller = new AbortController();
  const { signal } = controller;
  let open: HTMLElement | null = null;

  const position = () => {
    if (!open) return;
    const anchor = open.closest('[data-comparison-row]')!.querySelector('[data-comparison-notes]')!.getBoundingClientRect();
    const width = open.offsetWidth;
    const height = open.offsetHeight;
    open.style.left = `${Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16))}px`;
    const below = anchor.bottom + 12;
    open.style.top = `${Math.max(16, Math.min(below, window.innerHeight - height - 16))}px`;
  };
  const close = () => {
    open?.hidePopover();
    open = null;
  };

  document.querySelectorAll<HTMLElement>('[data-comparison-row]').forEach(row => {
    const popup = row.querySelector<HTMLElement>('.comparison-callout')!;
    const trigger = row.querySelector<HTMLButtonElement>('[data-comparison-notes]')!;
    trigger.addEventListener('click', () => {
      if (popup.matches(':popover-open')) close();
      else {
        close();
        open = popup;
        popup.showPopover();
        position();
      }
    }, { signal });
    popup.addEventListener('toggle', event => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      trigger.setAttribute('aria-expanded', String(isOpen));
      if (!isOpen && open === popup) {
        open = null;
      }
    }, { signal });
  });
  window.addEventListener('resize', position, { signal });
  window.addEventListener('scroll', position, { signal, capture: true });
  window.addEventListener('blur', close, { signal });
  return () => { close(); controller.abort(); };
}
