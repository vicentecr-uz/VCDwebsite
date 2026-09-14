import { normalizeHref } from '../lib/normalizeHref.mjs';
import { pageHistory } from '../lib/devHistory';
import { isDevContentEditing } from './devSectionMount';

const awardRoot = (target: EventTarget | null) => target instanceof Element
  ? target.closest<HTMLElement>('[data-project-award]') : null;

export function syncAwardLink(root: HTMLElement) {
  const proxy = root.querySelector<HTMLElement>('.project-award__proxy');
  const hit = root.querySelector<HTMLAnchorElement>('.project-award__hit');
  if (!proxy || !hit) return;
  const href = normalizeHref(proxy.textContent || '');
  if (href) {
    hit.setAttribute('href', href);
    hit.target = '_blank';
    hit.rel = 'noopener noreferrer';
  } else {
    hit.removeAttribute('href');
    hit.removeAttribute('target');
    hit.removeAttribute('rel');
  }
}

export function bindProjectAwardEditors(signal: AbortSignal) {
  let active: HTMLElement | null = null;
  const close = (focus = false) => {
    if (!active) return;
    const root = active;
    active = null;
    root.querySelector<HTMLFormElement>('[data-award-editor]')!.hidden = true;
    const edit = root.querySelector<HTMLButtonElement>('[data-award-edit]')!;
    edit.hidden = !isDevContentEditing();
    edit.setAttribute('aria-expanded', 'false');
    if (focus && root.isConnected) edit.focus({ preventScroll: true });
  };
  const apply = (root: HTMLElement, value: string) => {
    if (!isDevContentEditing()) return;
    const input = root.querySelector<HTMLInputElement>('[data-award-input]')!;
    const normalized = normalizeHref(value);
    if (value.trim() && !normalized) {
      input.setCustomValidity('Use a URL like google.com, https://…, /path, #hash, or mailto:');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    const proxy = root.querySelector<HTMLElement>('.project-award__proxy')!;
    pageHistory.breakGroup();
    proxy.textContent = normalized || '';
    syncAwardLink(root);
    proxy.dispatchEvent(new Event('input', { bubbles: true }));
    queueMicrotask(() => pageHistory.breakGroup());
    close(true);
  };
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const root = awardRoot(target);
    if (!root || !isDevContentEditing()) return;
    if (target?.closest('[data-award-edit]')) {
      event.preventDefault();
      close();
      active = root;
      const input = root.querySelector<HTMLInputElement>('[data-award-input]')!;
      input.value = root.querySelector('.project-award__proxy')?.textContent || '';
      input.setCustomValidity('');
      const edit = root.querySelector<HTMLButtonElement>('[data-award-edit]')!;
      edit.hidden = true;
      edit.setAttribute('aria-expanded', 'true');
      root.querySelector<HTMLFormElement>('[data-award-editor]')!.hidden = false;
      input.dispatchEvent(new CustomEvent('vcd:text-field-sync', { bubbles: true }));
      input.focus({ preventScroll: true });
      input.select();
    } else if (target?.closest('[data-award-remove]')) {
      event.preventDefault();
      apply(root, '');
    } else if (target?.closest('.project-award__hit')) {
      event.preventDefault();
    }
  }, { signal });
  document.addEventListener('submit', (event) => {
    const root = awardRoot(event.target);
    if (!root || !(event.target instanceof HTMLFormElement) || !event.target.matches('[data-award-editor]')) return;
    event.preventDefault();
    apply(root, root.querySelector<HTMLInputElement>('[data-award-input]')!.value);
  }, { signal });
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-award-input]')) event.target.setCustomValidity('');
  }, { signal });
  document.addEventListener('pointerdown', (event) => {
    if (active && !active.querySelector('[data-award-editor]')?.contains(event.target as Node)) close();
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active) { event.preventDefault(); close(true); }
  }, { signal });
  document.addEventListener('focusin', (event) => {
    if (active && !active.contains(event.target as Node)) close();
  }, { signal });
  window.addEventListener('vcd:dev-mode-change', () => close(), { signal });
  window.addEventListener('vcd:page-surface-change', () => close(), { signal });
  const observer = new MutationObserver((records) => {
    const roots = new Set<HTMLElement>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest('.project-award__proxy')) {
        const root = awardRoot(target);
        if (root) roots.add(root);
      }
    }
    roots.forEach(syncAwardLink);
    if (active && !active.isConnected) close();
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  signal.addEventListener('abort', () => { close(); observer.disconnect(); }, { once: true });
}
