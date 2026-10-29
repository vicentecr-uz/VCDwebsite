type UmamiWindow = Window & {
  __vcdTrackedEvents?: Set<string>;
  umami?: { track?: (name: string, data?: Record<string, string>) => void | Promise<unknown> };
};

/** Send a Umami custom event at most once per window; silently no-ops off production, on excluded paths, or when opted out. */
export function trackEvent(name: string, data?: Record<string, string>) {
  const win = window as UmamiWindow;
  const script = document.querySelector<HTMLScriptElement>('script[data-website-id]');
  const domains = script?.dataset.domains?.split(/[\s,]+/).filter(Boolean) ?? [];
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const track = win.umami?.track;
  if (!script || typeof track !== 'function' || !domains.includes(location.hostname) || pathname === '/analytics' ||
    pathname === '/dev' || pathname.startsWith('/dev/')) return;
  try {
    if (window.localStorage.getItem('umami.disabled')) return;
  } catch {
    return;
  }
  // This Set deduplicates within one document; Umami Visits provide cross-reload aggregation.
  const tracked = win.__vcdTrackedEvents ??= new Set<string>();
  if (tracked.has(name)) return;
  tracked.add(name);
  try {
    const result = track.call(win.umami, name, data);
    if (result && typeof result.then === 'function') result.catch(() => {});
  } catch {
    // Analytics failures must not affect the page.
  }
}
