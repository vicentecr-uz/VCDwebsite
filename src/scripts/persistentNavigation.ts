import { swapFunctions } from 'astro:transitions/client';
import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { persistentPageParts, supportsPersistentPage, swapPageContent } from '../lib/persistentPageSwap';
import { setIntroFoldOffsets } from '../lib/safeVh';

type Hooks = {
  cover: () => Promise<void>;
  reveal: () => void;
  cancel: () => void;
  beforeSwap: () => void;
};

export function installPersistentNavigation(hooks: Hooks) {
  if (!document.querySelector('[name="astro-view-transitions-enabled"]')) return;
  let navigation: TransitionBeforePreparationEvent | undefined;
  let swapped = false;
  const announceTitle = (title?: string) => {
    const visible = document.querySelector('.header-trigger__wordmark[aria-hidden="false"]');
    document.dispatchEvent(new CustomEvent('header:navigation-start', {
      detail: { pending: { title: visible?.textContent?.trim(), targetTitle: title } },
    }));
  };
  document.addEventListener('astro:before-preparation', ((event: TransitionBeforePreparationEvent) => {
    if (event.defaultPrevented) return;
    navigation = event;
    swapped = false;
    if (event.formData) { event.preventDefault(); return; }
    if (document.documentElement.dataset.devTransition === 'visible') event.to.searchParams.set('dev-transition', 'visible');
    document.documentElement.dataset.headerNavigation = '';
    const title = (event.sourceElement as HTMLElement | undefined)?.dataset.headerNavigationTitle;
    announceTitle(title);
    const covered = hooks.cover();
    queueMicrotask(() => {
      if (event.defaultPrevented && navigation === event) hooks.cancel();
    });
    const loader = event.loader;
    event.loader = async () => {
      try {
        await loader();
        if (event.signal.aborted || event.defaultPrevented) return;
        const parts = persistentPageParts(event.newDocument);
        // Only lifecycle-supported editor islands join the retained public shell.
        if (!parts || !supportsPersistentPage(event.newDocument)) {
          event.preventDefault(); return;
        }
        if (!title) announceTitle(parts.header.querySelector('.header-trigger__wordmark--page')?.textContent?.trim());
        await covered;
      } catch (error) {
        if (!event.signal.aborted) { hooks.cancel(); event.preventDefault(); }
      }
    };
    event.signal.addEventListener('abort', () => {
      queueMicrotask(() => { if (navigation === event && !swapped) hooks.cancel(); });
    }, { once: true });
  }) as EventListener);

  document.addEventListener('astro:before-swap', ((event: TransitionBeforeSwapEvent) => {
    void event.viewTransition.ready.catch(() => {});
    event.viewTransition.skipTransition();
    event.swap = () => {
      const nextHeader = persistentPageParts(event.newDocument)!.header;
      hooks.beforeSwap();
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('.site-header')) active.blur();
      swapFunctions.deselectScripts(event.newDocument);
      const safeVh = document.documentElement.style.getPropertyValue('--vh-safe');
      swapFunctions.swapRootAttributes(event.newDocument);
      if (safeVh) document.documentElement.style.setProperty('--vh-safe', safeVh);
      let unseenHome = false;
      if (event.to.pathname === '/') {
        try { unseenHome = sessionStorage.getItem('vcd:home-intro-seen') !== 'true'; } catch { unseenHome = true; }
      }
      if (!unseenHome) document.documentElement.dataset.headerNavigation = '';
      swapFunctions.swapHeadElements(event.newDocument);
      swapPageContent(document, event.newDocument);
      document.dispatchEvent(new CustomEvent('header:navigation-commit', { detail: { header: nextHeader, url: event.to } }));
      swapped = true;
    };
  }) as EventListener);
  document.addEventListener('astro:page-load', () => {
    if (!swapped) return;
    swapped = false;
    navigation = undefined;
    setIntroFoldOffsets();
    document.documentElement.dataset.introLayoutReady = 'true';
    window.dispatchEvent(new Event('vcd:intro-layout-ready'));
    queueMicrotask(hooks.reveal);
  });
}
