const SELECTOR = 'sup[data-inline-sidenote]';
const ROOT_SELECTOR = '[data-inline-sidenote-block="true"]';
let nextMarkerId = 0;

const readNote = (marker: HTMLElement) => marker.dataset.inlineSidenote ?? '';

export const syncInlineSidenotes = (section: HTMLElement) => {
  if (!section.matches(ROOT_SELECTOR)) return;
  const body = section.querySelector<HTMLElement>(':scope > .project-body-text');
  if (!body) return;
  let notes = section.querySelector<HTMLElement>(':scope > .dev-inline-sidenotes');
  if (!notes) {
    notes = document.createElement('aside');
    notes.className = 'dev-inline-sidenotes';
    notes.setAttribute('aria-label', 'Sidenotes');
    section.append(notes);
  }
  const markers = [...body.querySelectorAll<HTMLElement>(SELECTOR)];
  section.classList.toggle('has-inline-sidenotes', markers.length > 0);
  const current = new Map([...notes.children].map((child) => [
    (child as HTMLElement).dataset.inlineSidenoteId ?? '', child as HTMLElement,
  ]));
  let nextTop = 0;
  markers.forEach((marker, index) => {
    const label = String(index + 1);
    if (marker.textContent !== label) marker.textContent = label;
    if (marker.contentEditable !== 'false') marker.contentEditable = 'false';
    marker.dataset.inlineSidenoteId ||= `inline-note-${++nextMarkerId}`;
    marker.setAttribute('role', 'button');
    marker.setAttribute('tabindex', '0');
    marker.setAttribute('aria-label', `Edit sidenote ${index + 1}`);
    const noteId = marker.dataset.inlineSidenoteId;
    const note = current.get(noteId) ?? document.createElement('div');
    current.delete(noteId);
    note.className = 'dev-inline-sidenotes__note';
    note.dataset.inlineSidenoteIndex = String(index);
    note.dataset.inlineSidenoteId = noteId;
    note.id ||= noteId;
    const number = note.querySelector<HTMLElement>('.dev-inline-sidenotes__number') ?? document.createElement('span');
    number.className = 'dev-inline-sidenotes__number';
    if (number.textContent !== label) number.textContent = label;
    const text = note.querySelector<HTMLElement>('.dev-inline-sidenotes__text') ?? document.createElement('div');
    text.className = 'dev-inline-sidenotes__text';
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-label', `Sidenote ${index + 1}`);
    text.spellcheck = true;
    if (text.textContent !== readNote(marker)) text.textContent = readNote(marker);
    const editable = body.isContentEditable ? 'plaintext-only' : 'false';
    if (text.getAttribute('contenteditable') !== editable) text.setAttribute('contenteditable', editable);
    const tabIndex = body.isContentEditable ? 0 : -1;
    if (text.tabIndex !== tabIndex) text.tabIndex = tabIndex;
    const placeholder = body.isContentEditable ? 'Add a note…' : '';
    if (text.dataset.placeholder !== placeholder) text.dataset.placeholder = placeholder;
    if (!number.parentElement) note.append(number);
    if (!text.parentElement) note.append(text);
    if (notes.children[index] !== note) notes.insertBefore(note, notes.children[index] ?? null);
    const sectionRect = section.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const top = Math.max(nextTop, markerRect.top - sectionRect.top);
    note.style.top = `${top}px`;
    nextTop = top + note.getBoundingClientRect().height + 16;
    marker.setAttribute('aria-controls', note.id);
    marker.setAttribute('aria-expanded', String(!matchMedia('(max-width: 69.499em)').matches || note.classList.contains('is-open')));
  });
  current.forEach((note) => note.remove());
};

export const bindInlineSidenotes = (scope: Document | HTMLElement) => {
  scope.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(syncInlineSidenotes);
  const onInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const section = target.closest<HTMLElement>(ROOT_SELECTOR);
    if (!section) return;
    const body = section.querySelector<HTMLElement>(':scope > .project-body-text');
    const noteEditor = target.closest<HTMLElement>('.dev-inline-sidenotes__text');
    if (noteEditor) {
      const index = Number(noteEditor.closest<HTMLElement>('.dev-inline-sidenotes__note')?.dataset.inlineSidenoteIndex);
      const marker = body?.querySelectorAll<HTMLElement>(SELECTOR)[index];
      if (marker) {
        marker.dataset.inlineSidenote = noteEditor.textContent ?? '';
        body?.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    syncInlineSidenotes(section);
  };
  const onMouseDown = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const marker = target.closest<HTMLElement>(SELECTOR);
    if (!marker) return;
    event.preventDefault();
    const section = marker.closest<HTMLElement>(ROOT_SELECTOR);
    const index = [...(section?.querySelectorAll<HTMLElement>(SELECTOR) ?? [])].indexOf(marker);
    const note = section?.querySelector<HTMLElement>(`.dev-inline-sidenotes__note[data-inline-sidenote-index="${index}"]`);
    if (!note) return;
    note.classList.toggle('is-open');
    marker.setAttribute('aria-expanded', String(note.classList.contains('is-open')));
    if (matchMedia('(max-width: 69.499em)').matches && note.classList.contains('is-open') && section.dataset.devInlineSidenotes === 'true') {
      note.querySelector<HTMLElement>('.dev-inline-sidenotes__text')?.focus({ preventScroll: true });
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  };
  scope.addEventListener('input', onInput);
  scope.addEventListener('mousedown', onMouseDown);
  scope.addEventListener('keydown', onKeyDown, true);
  const onResize = () => scope.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(syncInlineSidenotes);
  window.addEventListener('resize', onResize);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLElement
        && record.target.matches('.project-body-text[data-dev-text-kind="paragraphs"]')) {
        const section = record.target.closest<HTMLElement>(ROOT_SELECTOR);
        if (section) syncInlineSidenotes(section);
      }
      if (record.type === 'childList') {
        const body = record.target instanceof HTMLElement
          ? record.target.closest<HTMLElement>('.project-body-text[data-dev-text-kind="paragraphs"]')
          : record.target.parentElement?.closest<HTMLElement>('.project-body-text[data-dev-text-kind="paragraphs"]');
        const section = body?.closest<HTMLElement>(ROOT_SELECTOR);
        if (section) syncInlineSidenotes(section);
      }
      record.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches(ROOT_SELECTOR)) syncInlineSidenotes(node);
        node.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(syncInlineSidenotes);
      });
    }
  });
  observer.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ['contenteditable'] });
  return () => {
    observer.disconnect();
    scope.removeEventListener('input', onInput);
    scope.removeEventListener('mousedown', onMouseDown);
    scope.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize);
  };
};
