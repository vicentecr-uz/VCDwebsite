/**
 * Dev-only employer-view context.
 *
 * The active view is decided server-side (VIEW_ID env or the Alt+V active-view
 * file) and stamped onto <html data-view-id>. The client reads it from there —
 * there is no cookie/sessionStorage state to keep in sync.
 */

let plannedNavigation = false;

export function devViewId(): string {
  if (typeof document === 'undefined') return '';
  return document.documentElement.dataset.viewId || '';
}

export function withDevViewId<T extends Record<string, unknown>>(body: T): T & { viewId?: string } {
  const viewId = devViewId();
  if (!viewId) return body;
  return { ...body, viewId };
}

/** True while a dev-only navigation (view switch reload) is in progress. */
export function isPlannedDevNavigation() {
  return plannedNavigation;
}

export function beginPlannedDevNavigation() {
  plannedNavigation = true;
}

/** Ask DevTextEditor (and peers) whether a reload may discard unsaved edits. */
export function confirmBeforeDevReload() {
  const event = new CustomEvent('vcd:before-reload', { cancelable: true });
  window.dispatchEvent(event);
  return !event.defaultPrevented;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the dev server to restart after a view switch. The supervisor cycles
 * `astro dev`, so we reload as soon as either signal fires:
 *   1. the restarted server reports the requested view via <html data-view-id>, or
 *   2. the server has come back up after we observed it go down.
 * The second signal is the safety net if the HTML probe is flaky mid-restart.
 */
async function waitForDevServerRestart(viewId: string, timeoutMs = 25000) {
  const start = Date.now();
  let sawServerDown = false;
  await sleep(300);
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(window.location.href, { cache: 'no-store' });
      if (response.ok) {
        const html = await response.text();
        const current = html.match(/data-view-id="([^"]*)"/)?.[1] ?? '';
        if (current === viewId) return;
        if (sawServerDown) return;
      } else {
        sawServerDown = true;
      }
    } catch {
      // Connection refused — the server is mid-restart.
      sawServerDown = true;
    }
    await sleep(250);
  }
}

/** Persist the chosen view (dev), wait for the server restart, then reload. */
export async function switchDevView(viewId: string) {
  const response = await fetch('/api/dev-set-view', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ viewId }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Could not switch view.');
  }
  beginPlannedDevNavigation();
  await waitForDevServerRestart(viewId);
  window.location.reload();
}
