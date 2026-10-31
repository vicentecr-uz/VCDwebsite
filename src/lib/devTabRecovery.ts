type TabState = { generation: string; fingerprint: string };

export function installDevTabRecovery() {
  const host = window as Window & { __vcdTabRecovery?: boolean };
  if (host.__vcdTabRecovery) return;
  host.__vcdTabRecovery = true;
  const readState = (): TabState => JSON.parse(document.querySelector<HTMLMetaElement>('meta[name="vcd-tab-state"]')!.content);
  let baseline = readState();
  let checking = false;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const mutation = url.origin === location.origin && url.pathname.startsWith('/api/')
      && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
      && !['/api/dev-session-state', '/api/dev-branch-update'].includes(url.pathname);
    if (mutation) {
      request.headers.set('x-vcd-tab-generation', baseline.generation);
      request.headers.set('x-vcd-tab-fingerprint', baseline.fingerprint);
    }
    const response = await originalFetch(request);
    const fingerprint = response.headers.get('x-vcd-tab-fingerprint');
    if (mutation && response.ok && fingerprint) baseline.fingerprint = fingerprint;
    return response;
  };
  const check = async () => {
    if (checking || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    checking = true;
    try {
      const response = await originalFetch('/api/dev-tab-state', { cache: 'no-store' });
      if (!response.ok) return;
      const state: TabState = await response.json();
      if (state.generation === baseline.generation) return;
      const detail: { recover?: () => Promise<void> } = {};
      window.dispatchEvent(new CustomEvent('vcd:dev-tab-stale', { detail }));
      await detail.recover?.();
    } catch {
      // A restarting server is retried on focus or the next visible poll.
    } finally {
      checking = false;
    }
  };
  document.addEventListener('astro:page-load', () => { baseline = readState(); });
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('vcd:dev-reconnect', check);
  setInterval(check, 15_000);
}
