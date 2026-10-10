import gripIcon from 'lucide-static/icons/grip-vertical.svg?raw';
import { sizeIcon } from './icons';

export const SECTION_DRAG_HANDLE_ATTR = 'data-dev-section-drag-handle';

export interface SectionReorderHandleOptions {
  label?: string;
  title?: string;
  tabIndex?: number;
  demo?: boolean;
  pressed?: boolean;
}

const escapeAttribute = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

export function sectionReorderHandleMarkup({
  label = 'Drag to reorder section',
  title = 'Drag to reorder · Save to persist',
  tabIndex = -1,
  demo = false,
  pressed,
}: SectionReorderHandleOptions = {}) {
  const demoAttr = demo ? ' data-reorder-demo-handle' : '';
  const pressedAttr = pressed === undefined ? '' : ` aria-pressed="${pressed}"`;
  const safeLabel = escapeAttribute(label);
  const safeTitle = escapeAttribute(title);
  return `<button type="button" class="dev-section-drag-handle" ${SECTION_DRAG_HANDLE_ATTR}${demoAttr} aria-label="${safeLabel}" title="${safeTitle}"${pressedAttr} tabindex="${tabIndex}">${sizeIcon(gripIcon, 16)}</button>`;
}

export function createSectionReorderHandle(document: Document, label = 'Drag to reorder section') {
  const template = document.createElement('template');
  template.innerHTML = sectionReorderHandleMarkup({ label });
  return template.content.firstElementChild as HTMLButtonElement;
}
