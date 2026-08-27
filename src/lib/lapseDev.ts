import '@aiforui/lapse/install';
import gsap from 'gsap';
// getSharedEngine from /panel (not the React entry) — this project has no react/react-dom,
// and Vite fails optional peer resolution on `@aiforui/lapse` with a hard error.
import { getSharedEngine, mountLapse } from '@aiforui/lapse/panel';

getSharedEngine().registerGSAP(gsap);
mountLapse();

// Visibility only — do not unmount. Unmount resets speed to 1× and drops take state.
const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

window.addEventListener('keydown', (e) => {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (e.code !== 'KeyL') return;
  if (isTypingTarget(e.target)) return;

  const host = document.querySelector<HTMLElement>('[data-lapse-panel]');
  if (!host) return;

  e.preventDefault();
  host.hidden = !host.hidden;
});
