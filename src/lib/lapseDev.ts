import gsap from 'gsap';
import { getSharedEngine, mountLapse } from '@aiforui/lapse/panel';

if (!document.documentElement.hasAttribute('data-canvas-shell')) {
  await import('@aiforui/lapse/install');
  getSharedEngine().registerGSAP(gsap);
  mountLapse();

  const panelHost = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-lapse-slot]');

  const hidePanelByDefault = () => {
    const host = panelHost();
    if (!host) return false;
    host.hidden = true;
    return true;
  };

  if (!hidePanelByDefault()) {
    const mo = new MutationObserver(() => {
      if (hidePanelByDefault()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  const isTypingTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  };

  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (e.code !== 'KeyL') return;
    if (isTypingTarget(e.target)) return;

    const host = panelHost();
    if (!host) return;

    e.preventDefault();
    host.hidden = !host.hidden;
  });
}
