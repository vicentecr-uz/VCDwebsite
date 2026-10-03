const KEYBOARD_GAP_PX = 150;
const RECENT_BLUR_MS = 300;
const MIN_SETTLE_MS = 350;
const QUIET_MS = 150;
const MAX_SETTLE_MS = 1200;

const hasTouchOrCoarsePointer = () => (
  window.matchMedia('(pointer: coarse)').matches
  || window.matchMedia('(hover: none)').matches
  || navigator.maxTouchPoints > 0
  || 'ontouchstart' in window
);

const keyboardLikelyVisible = () => {
  const viewport = window.visualViewport;
  return Boolean(viewport && document.documentElement.clientHeight - viewport.height > KEYBOARD_GAP_PX);
};

/** Wait for the mobile keyboard and scroll position to finish settling. */
export function waitForSignupViewportSettlement(
  input: HTMLInputElement,
  lastBlurAt = Number.NEGATIVE_INFINITY,
  signal?: AbortSignal,
): Promise<void> {
  if (!hasTouchOrCoarsePointer()) return Promise.resolve();

  const inputFocused = document.activeElement === input;
  const blurredRecently = performance.now() - lastBlurAt <= RECENT_BLUR_MS;
  if (!inputFocused && !blurredRecently && !keyboardLikelyVisible()) return Promise.resolve();

  return new Promise((resolve) => {
    let finished = false;
    let minTimer: ReturnType<typeof setTimeout>;
    let quietTimer: ReturnType<typeof setTimeout>;
    let deadlineTimer: ReturnType<typeof setTimeout>;

    const viewport = window.visualViewport;
    const cleanup = () => {
      window.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('pagehide', onPageHide);
      signal?.removeEventListener('abort', finish);
      viewport?.removeEventListener('resize', onViewportChange);
      viewport?.removeEventListener('scroll', onViewportChange);
      clearTimeout(minTimer);
      clearTimeout(quietTimer);
      clearTimeout(deadlineTimer);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve();
    };
    const maybeFinish = () => {
      if (Date.now() >= quietUntil && Date.now() >= minUntil) finish();
    };
    const minUntil = Date.now() + MIN_SETTLE_MS;
    let quietUntil = Date.now() + QUIET_MS;
    const armQuietTimer = () => {
      clearTimeout(quietTimer);
      quietUntil = Date.now() + QUIET_MS;
      quietTimer = setTimeout(maybeFinish, QUIET_MS);
    };
    const onViewportChange = () => armQuietTimer();
    const onPageHide = () => finish();

    if (signal?.aborted) { finish(); return; }
    signal?.addEventListener('abort', finish, { once: true });
    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.addEventListener('pagehide', onPageHide, { once: true });
    viewport?.addEventListener('resize', onViewportChange);
    viewport?.addEventListener('scroll', onViewportChange);
    minTimer = setTimeout(maybeFinish, MIN_SETTLE_MS);
    armQuietTimer();
    // Bound the wait so a browser that never reports its final viewport cannot hold the form busy.
    deadlineTimer = setTimeout(finish, MAX_SETTLE_MS);
  });
}
