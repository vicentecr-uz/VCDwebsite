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
  let preserveTitleMotion = false;
  const headerVisibleForTitleMotion = () => {
    const header = document.querySelector<HTMLElement>('.site-header');
    if (!header || header.classList.contains('is-scrolled-hidden')) return false;
    const rect = header.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    if (!(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight)) return false;
    for (let element: HTMLElement | null = header; element; element = element.parentElement) {
      const style = document.defaultView?.getComputedStyle(element);
      if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || parseFloat(style.opacity) === 0) return false;
      if (element === document.body) break;
    }
    return true;
  };
  const unseenHome = (url: URL) => {
    if (url.pathname !== '/') return false;
    try { return sessionStorage.getItem('vcd:home-intro-seen') !== 'true'; } catch { return true; }
  };
  const announceTitle = (title?: string, animateTitle = preserveTitleMotion) => {
    const visible = document.querySelector('.header-trigger__wordmark[aria-hidden="false"]');
    document.dispatchEvent(new CustomEvent('header:navigation-start', {
      detail: { animateTitle, pending: { title: visible?.textContent?.trim(), targetTitle: title } },
    }));
    if (!animateTitle || (navigation && unseenHome(navigation.to))) document.documentElement.removeAttribute('data-header-navigation');
  };
  document.addEventListener('astro:before-preparation', ((event: TransitionBeforePreparationEvent) => {
    if (event.defaultPrevented) return;
    navigation = event;
    swapped = false;
    const preserveTitleMotionForNavigation = headerVisibleForTitleMotion();
    preserveTitleMotion = preserveTitleMotionForNavigation;
    if (event.formData) { event.preventDefault(); return; }
    if (document.documentElement.dataset.devTransition === 'visible') event.to.searchParams.set('dev-transition', 'visible');
    if (preserveTitleMotionForNavigation) document.documentElement.dataset.headerNavigation = '';
    else document.documentElement.removeAttribute('data-header-navigation');
    const title = (event.sourceElement as HTMLElement | undefined)?.dataset.headerNavigationTitle;
    announceTitle(title, preserveTitleMotionForNavigation);
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
        if (!title) announceTitle(parts.header.querySelector('.header-trigger__wordmark--page')?.textContent?.trim(), preserveTitleMotionForNavigation);
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
      if (preserveTitleMotion && !unseenHome(event.to)) document.documentElement.dataset.headerNavigation = '';
      else document.documentElement.removeAttribute('data-header-navigation');
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
