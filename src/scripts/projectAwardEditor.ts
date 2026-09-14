import { normalizeHref } from '../lib/normalizeHref.mjs';

export function bindProjectAwardEditors(rootDocument: Document = document) {
  rootDocument.querySelectorAll<HTMLElement>('[data-project-award]').forEach((root) => {
    if (root.dataset.awardBound === 'true') return;
    root.dataset.awardBound = 'true';
    const edit = root.querySelector<HTMLButtonElement>('[data-award-edit]');
    const editor = root.querySelector<HTMLFormElement>('[data-award-editor]');
    const input = root.querySelector<HTMLInputElement>('[data-award-input]');
    const remove = root.querySelector<HTMLButtonElement>('[data-award-remove]');
    const proxy = root.querySelector<HTMLElement>('[data-dev-text-path]');
    if (!edit || !editor || !input || !remove || !proxy) return;
    const link = () => root.dataset.projectAwardHref || '';
    const close = () => { editor.hidden = true; edit.hidden = false; root.classList.remove('is-award-editing'); };
    const open = () => { input.value = link(); edit.hidden = true; editor.hidden = false; root.classList.add('is-award-editing'); requestAnimationFrame(() => input.focus()); };
    const apply = (value: string) => {
      const normalized = normalizeHref(value);
      if (value.trim() && !normalized) { input.setCustomValidity('Enter a valid link.'); input.reportValidity(); return; }
      input.setCustomValidity('');
      const next = normalized || '';
      root.dataset.projectAwardHref = next;
      proxy.textContent = next;
      proxy.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
      const hit = root.querySelector<HTMLAnchorElement>('.project-award__hit');
      if (hit && next) hit.href = next;
      if (hit && !next) hit.replaceWith(hit.querySelector('img')!);
      close();
    };
    edit.addEventListener('click', (event) => { event.preventDefault(); open(); });
    editor.addEventListener('submit', (event) => { event.preventDefault(); apply(input.value); });
    remove.addEventListener('click', () => { input.value = ''; apply(''); });
    rootDocument.addEventListener('pointerdown', (event) => { if (!editor.hidden && !root.contains(event.target as Node)) close(); });
    rootDocument.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !editor.hidden) close(); });
  });
}
