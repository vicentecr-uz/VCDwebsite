import '@aiforui/lapse/install';
import gsap from 'gsap';
// getSharedEngine from /panel (not the React entry) — this project has no react/react-dom,
// and Vite fails optional peer resolution on `@aiforui/lapse` with a hard error.
import { getSharedEngine, mountLapse } from '@aiforui/lapse/panel';

getSharedEngine().registerGSAP(gsap);
mountLapse();

// Visibility only — do not unmount. Unmount resets speed to 1× and drops take state.
// Panel host is created asynchronously (React root after mountLapse), so hide when it appears.
const panelHost = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-lapse-panel]');

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
