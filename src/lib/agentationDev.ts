import { Agentation, type AgentationProps } from 'agentation';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const ROOT_ID = 'agentation-root';
const TOOLBAR_SELECTOR = '[data-agentation-toolbar] > [role="button"]';
const ENTER_MS = 150;
const EXIT_MS = 120;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let toolbarObserver: MutationObserver | null = null;
let isClosing = false;

const motionStyles = document.createElement('style');
motionStyles.textContent = `
  [data-agentation-toolbar] > * {
    animation: none !important;
  }

  [data-agentation-root][data-vcd-opening] [data-agentation-toolbar] * {
    animation: none !important;
    transition: none !important;
  }
`;
document.head.append(motionStyles);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const startCommenting = () => {
  const startButton = document.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
  const toolbar = startButton?.parentElement;
  const portal = toolbar?.closest<HTMLElement>('[data-agentation-root]');
  if (!startButton || !toolbar || !portal) return false;

  portal.dataset.vcdOpening = '';
  toolbar.style.opacity = '0';
  startButton.click();

  requestAnimationFrame(() => {
    if (!portal.isConnected) return;
    void toolbar.offsetWidth;
    delete portal.dataset.vcdOpening;
    toolbar.style.opacity = '1';

    if (!reduceMotion.matches) {
      toolbar.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ENTER_MS,
        easing: 'ease-out',
      });
    }
  });

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

const unmountAgentation = () => {
  toolbarObserver?.disconnect();
  toolbarObserver = null;
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  isClosing = false;
};

const disableAgentation = (immediate = false) => {
  const toolbar = document.querySelector<HTMLElement>('[data-agentation-toolbar]');
  if (immediate || !toolbar || reduceMotion.matches) {
    unmountAgentation();
    return;
  }

  isClosing = true;
  toolbar.style.pointerEvents = 'none';
  toolbar.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: EXIT_MS,
    easing: 'ease-in',
    fill: 'forwards',
  }).finished.then(unmountAgentation, unmountAgentation);
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

  if (isClosing) return;
  if (root) disableAgentation();
  else enableAgentation();
};

window.addEventListener('keydown', handleShortcut, true);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('keydown', handleShortcut, true);
    disableAgentation(true);
    motionStyles.remove();
  });
}
