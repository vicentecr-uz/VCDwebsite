import { Agentation, type AgentationProps } from 'agentation';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const ROOT_ID = 'agentation-root';
const TOOLBAR_SELECTOR = '[data-agentation-toolbar] > [role="button"]';

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let toolbarObserver: MutationObserver | null = null;

const startCommenting = () => {
  const toolbar = document.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
  if (!toolbar) return false;
  toolbar.click();
  return true;
};

const enableAgentation = () => {
  container = document.createElement('div');
  container.id = ROOT_ID;
  document.body.append(container);

  toolbarObserver = new MutationObserver(() => {
    if (!startCommenting()) return;
    toolbarObserver?.disconnect();
    toolbarObserver = null;
  });
  toolbarObserver.observe(document.body, { childList: true, subtree: true });

  root = createRoot(container);
  root.render(createElement<AgentationProps>(Agentation, {
    endpoint: 'http://localhost:4747',
  }));
};

const disableAgentation = () => {
  toolbarObserver?.disconnect();
  toolbarObserver = null;
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
};

const isTypingTarget = (target: EventTarget | null) => {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element && (element.isContentEditable || element.closest('input, textarea, select')));
};

const handleShortcut = (event: KeyboardEvent) => {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.code !== 'KeyC') return;
  if (isTypingTarget(event.target)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (root) disableAgentation();
  else enableAgentation();
};

window.addEventListener('keydown', handleShortcut, true);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('keydown', handleShortcut, true);
    disableAgentation();
  });
}
