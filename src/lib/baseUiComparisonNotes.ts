export function initComparisonNotes() {
  const controller = new AbortController();
  const { signal } = controller;
  let hovered: HTMLElement | null = null;
  let open: HTMLElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let pinned = false;
  let dismissed: HTMLElement | null = null;

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
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    open?.hidePopover();
    open = null;
    pinned = false;
  };
  const show = (row: HTMLElement, pin = false) => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    const popup = row.querySelector<HTMLElement>('.comparison-callout')!;
    if (open !== popup) close();
    open = popup;
    pinned = pin || pinned;
    popup.showPopover();
    position();
  };
  const scheduleClose = () => {
    clearTimeout(showTimer);
    if (!pinned) hideTimer = setTimeout(close, 220);
  };

  document.querySelectorAll<HTMLElement>('[data-comparison-row]').forEach(row => {
    const popup = row.querySelector<HTMLElement>('.comparison-callout')!;
    const trigger = row.querySelector<HTMLButtonElement>('[data-comparison-notes]')!;
    row.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      hovered = row;
      dismissed = null;
      if (pinned) return;
      clearTimeout(hideTimer);
      if (event.altKey) show(row);
      else showTimer = setTimeout(() => show(row), 1000);
    }, { signal });
    row.addEventListener('pointerleave', () => {
      hovered = null;
      dismissed = null;
      scheduleClose();
    }, { signal });
    row.addEventListener('pointerdown', () => {
      clearTimeout(showTimer);
      if (!pinned) close();
    }, { signal });
    trigger.addEventListener('click', () => {
      if (open === popup && pinned) close();
      else show(row, true);
    }, { signal });
    popup.addEventListener('pointerenter', () => clearTimeout(hideTimer), { signal });
    popup.addEventListener('pointerleave', scheduleClose, { signal });
    popup.addEventListener('toggle', event => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      trigger.setAttribute('aria-expanded', String(isOpen));
      if (!isOpen && open === popup) {
        open = null;
        pinned = false;
        dismissed = row;
      }
    }, { signal });
  });
  document.addEventListener('keydown', event => {
    clearTimeout(showTimer);
    if (event.key === 'Alt' && hovered && hovered !== dismissed && !pinned) show(hovered);
    if (event.key === 'Escape') {
      dismissed = hovered;
      close();
    }
  }, { signal });
  window.addEventListener('resize', position, { signal });
  window.addEventListener('scroll', position, { signal, capture: true });
  window.addEventListener('blur', close, { signal });
  return () => { close(); controller.abort(); };
}
