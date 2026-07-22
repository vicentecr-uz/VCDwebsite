const STORAGE_KEY = 'vcd-dev-view';
const COOKIE_NAME = 'vcd-dev-view';

export function devViewId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromSession = sessionStorage.getItem(STORAGE_KEY)?.trim();
    if (fromSession) return fromSession;
  } catch {
    // Ignore storage failures.
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export function withDevViewId<T extends Record<string, unknown>>(body: T): T & { viewId?: string } {
  const viewId = devViewId();
  if (!viewId) return body;
  return { ...body, viewId };
}
