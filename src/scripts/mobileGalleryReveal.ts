const TOUCH_MOVE_THRESHOLD = 10;
const SCROLL_SETTLE_MS = 250;
const PREVIEW_HOLD_MS = 1600;
const INITIAL_DELAY_MS = 1000;
const CLICK_GUARD_MS = 500;

type CoverCandidate = {
  item: HTMLElement;
  card: HTMLElement;
  cover: HTMLElement;
  hover: HTMLImageElement;
};

function mobileCapability(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function visibleArea(rect: DOMRect): number {
  const left = Math.max(0, rect.left);
  const right = Math.min(window.innerWidth, rect.right);
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function introVisible(): boolean {
  const intro = document.querySelector<HTMLElement>('[data-home-intro-surface]');
  return Boolean(intro && !intro.hidden && intro.dataset.state !== 'dismissed');
}

function candidateFor(item: HTMLElement): CoverCandidate | null {
  if (item.closest('[inert]')) return null;
  if (item.classList.contains('project-grid__item--new') || item.dataset.devProjectSlug === '__template__') return null;
  const card = item.querySelector<HTMLElement>('.project-grid__card');
  const cover = item.querySelector<HTMLElement>('.project-grid__cover.project-grid__cover--has-hover');
  const hover = cover?.querySelector<HTMLImageElement>('.project-grid__img--hover') ?? null;
  if (!card || !cover || !hover || hover.hidden || !hover.src || !hover.complete || hover.naturalWidth <= 0) return null;
  if (cover.dataset.devCoverEmpty === 'true') return null;
  const rect = card.getBoundingClientRect();
  const area = visibleArea(rect);
  const cardArea = Math.max(0, rect.width * rect.height);
  const viewportArea = Math.max(0, window.innerWidth * window.innerHeight);
  if (!area || area < 0.25 * Math.min(cardArea, viewportArea)) return null;
  return { item, card, cover, hover };
}

function allCandidates(): CoverCandidate[] {
  return [...document.querySelectorAll<HTMLElement>('.project-grid__item')]
    .map(candidateFor)
    .filter((candidate): candidate is CoverCandidate => Boolean(candidate));
}

export function bindMobileGalleryReveal(): () => void {
  let active: CoverCandidate | null = null;
  let initialTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let gesture: { id: number; x: number; y: number; origin: HTMLElement | null; moved: boolean } | null = null;
  let pendingOrigin: HTMLElement | null = null;
  let fingerDown = false;
  let clickGuard: HTMLElement | null = null;
  let clickGuardExpiry = 0;
  let initialScheduled = false;
  let initialCancelled = false;
  let disposed = false;

  const clearTimer = (timer: ReturnType<typeof setTimeout> | undefined) => {
    if (timer !== undefined) clearTimeout(timer);
  };

  const clearPreview = () => {
    clearTimer(holdTimer);
    holdTimer = undefined;
    active?.cover.classList.remove('is-mobile-preview');
    active = null;
  };

  const cancelPending = () => {
    clearTimer(settleTimer);
    settleTimer = undefined;
    pendingOrigin = null;
  };

  const resetGesture = () => {
    gesture = null;
    cancelPending();
  };

  const rankedCandidate = (origin: HTMLElement | null): CoverCandidate | null => {
    const candidates = allCandidates();
    if (origin) {
      const preferred = candidates.find((candidate) => candidate.item === origin);
      if (preferred) return preferred;
    }
    return candidates
      .map((candidate, index) => {
        const rect = candidate.card.getBoundingClientRect();
        const area = visibleArea(rect);
        const centerDistance = Math.hypot(
          (rect.left + rect.right) / 2 - window.innerWidth / 2,
          (rect.top + rect.bottom) / 2 - window.innerHeight / 2,
        );
        return { candidate, area, centerDistance, index };
      })
      .sort((a, b) => b.area - a.area || a.centerDistance - b.centerDistance || a.index - b.index)[0]?.candidate ?? null;
  };

  const reveal = (origin: HTMLElement | null) => {
    if (disposed || fingerDown || introVisible() || !mobileCapability() || document.hidden || document.documentElement.classList.contains('is-dev-mode')) return;
    const next = rankedCandidate(origin);
    if (!next) return;
    clearPreview();
    active = next;
    next.cover.classList.add('is-mobile-preview');
    holdTimer = setTimeout(clearPreview, PREVIEW_HOLD_MS);
  };

  const scheduleReveal = () => {
    clearTimer(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      const origin = pendingOrigin;
      pendingOrigin = null;
      reveal(origin);
    }, SCROLL_SETTLE_MS);
  };

  const onTouchStart = (event: TouchEvent) => {
    if (!mobileCapability() || document.documentElement.classList.contains('is-dev-mode')) return;
    initialCancelled = true;
    clearTimer(initialTimer);
    initialTimer = undefined;
    clearPreview();
    cancelPending();
    clickGuard = null;
    fingerDown = true;
    if (event.touches.length !== 1) {
      resetGesture();
      return;
    }
    const touch = event.touches[0];
    const target = touch.target instanceof Element ? touch.target.closest<HTMLElement>('.project-grid__item') : null;
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, origin: target, moved: false };
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!gesture || event.touches.length !== 1) {
      if (event.touches.length > 1) resetGesture();
      return;
    }
    const touch = [...event.touches].find((entry) => entry.identifier === gesture?.id);
    if (!touch) return;
    if (Math.abs(touch.clientY - gesture.y) >= TOUCH_MOVE_THRESHOLD) gesture.moved = true;
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (!gesture) {
      if (event.touches.length === 0) fingerDown = false;
      return;
    }
    const ended = [...event.changedTouches].some((touch) => touch.identifier === gesture?.id);
    if (!ended) return;
    const finished = gesture;
    const touch = [...event.changedTouches].find((entry) => entry.identifier === finished.id);
    gesture = null;
    fingerDown = event.touches.length > 0;
    if (fingerDown) return;
    const dx = touch ? touch.clientX - finished.x : 0;
    const dy = touch ? touch.clientY - finished.y : 0;
    if (!finished.moved || Math.abs(dy) < Math.abs(dx)) return;
    pendingOrigin = finished.origin;
    clickGuard = finished.origin;
    clickGuardExpiry = Date.now() + CLICK_GUARD_MS;
    scheduleReveal();
  };

  const onTouchCancel = (event: TouchEvent) => {
    fingerDown = event.touches.length > 0;
    resetGesture();
    clearPreview();
  };

  const onScroll = () => {
    initialCancelled = true;
    clearTimer(initialTimer);
    initialTimer = undefined;
    clearPreview();
    if (!fingerDown) {
      scheduleReveal();
    }
  };

  const onClick = (event: MouseEvent) => {
    if (!clickGuard || Date.now() > clickGuardExpiry) {
      clickGuard = null;
      return;
    }
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.project-grid__item') : null;
    if (target === clickGuard) {
      event.preventDefault();
      event.stopPropagation();
      clickGuard = null;
    }
  };

  const onVisibility = () => {
    if (document.hidden) {
      initialCancelled = true;
      clearTimer(initialTimer);
      initialTimer = undefined;
      fingerDown = false;
      resetGesture();
      clearPreview();
    }
  };

  const onMediaChange = () => {
    if (!mobileCapability()) {
      initialCancelled = true;
      fingerDown = false;
      resetGesture();
      clearPreview();
      clearTimer(initialTimer);
      initialTimer = undefined;
    }
  };

  const onHtmlMutation = () => {
    if (document.documentElement.classList.contains('is-dev-mode')) {
      initialCancelled = true;
      clearTimer(initialTimer);
      initialTimer = undefined;
      fingerDown = false;
      resetGesture();
      clearPreview();
    }
  };

  const scheduleInitial = () => {
    if (initialScheduled || initialCancelled || disposed || introVisible() || !mobileCapability()) return;
    const overlay = document.getElementById('transition-overlay');
    if (overlay && overlay.dataset.vcdInitialReveal !== 'complete') return;
    initialScheduled = true;
    initialTimer = setTimeout(() => {
      initialTimer = undefined;
      reveal(null);
    }, INITIAL_DELAY_MS);
  };

  const onInitialRevealComplete = () => {
    if (!initialCancelled) scheduleInitial();
  };
  const onHomeIntroDismissed = () => {
    initialCancelled = false;
    scheduleInitial();
  };
  const onPageHide = () => {
    initialCancelled = true;
    clearTimer(initialTimer);
    initialTimer = undefined;
    fingerDown = false;
    resetGesture();
    clearPreview();
  };

  const mediaQuery = window.matchMedia('(hover: none) and (pointer: coarse)');
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', onTouchCancel, { passive: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('scroll', onScroll, { passive: true });
  mediaQuery.addEventListener?.('change', onMediaChange);
  window.addEventListener('vcd:initial-reveal-complete', onInitialRevealComplete);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('vcd:home-intro-dismissed', onHomeIntroDismissed);
  const htmlObserver = new MutationObserver(onHtmlMutation);
  htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  scheduleInitial();

  return () => {
    disposed = true;
    clearTimer(initialTimer);
    clearTimer(settleTimer);
    resetGesture();
    clearPreview();
    htmlObserver.disconnect();
    window.removeEventListener('vcd:initial-reveal-complete', onInitialRevealComplete);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('vcd:home-intro-dismissed', onHomeIntroDismissed);
    mediaQuery.removeEventListener?.('change', onMediaChange);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('touchcancel', onTouchCancel);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('scroll', onScroll);
  };
}
