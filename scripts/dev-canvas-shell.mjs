import { extname } from 'node:path';

const excludedPrefixes = ['/dev/', '/api/', '/src/', '/@', '/node_modules/', '/_', '/preview/', '/reports/prototypes/'];

export function shouldServeCanvasShell({ method, url, headers }) {
  const pathname = new URL(url, 'http://localhost').pathname;
  return method === 'GET'
    && headers['sec-fetch-dest'] === 'document'
    && String(headers.accept ?? '').includes('text/html')
    && String(headers.cookie ?? '').split(';').some((cookie) => cookie.trim() === 'vcd-canvas=1')
    && !excludedPrefixes.some((prefix) => pathname.startsWith(prefix))
    && !extname(pathname);
}

/** After a flag toggle, go back to the page the link was clicked on (same host only). */
export function canvasFlagReturnPath(headers, url = '') {
  // A link from outside the site has no referer: `?to=/page` names where to land.
  const to = new URL(url || '/', 'http://localhost').searchParams.get('to');
  if (to && to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/dev/canvas/')) return to;
  try {
    const referer = new URL(String(headers.referer ?? ''));
    if (referer.host === headers.host && !referer.pathname.startsWith('/dev/canvas/')) return `${referer.pathname}${referer.search}${referer.hash}`;
  } catch { /* no usable referer */ }
  return '/';
}

export function devCanvasShell() {
  return {
    name: 'vcd-dev-canvas-shell',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (req.method === 'GET' && ['/dev/canvas/on', '/dev/canvas/off', '/dev/canvas/chrome-on', '/dev/canvas/chrome-off'].includes(pathname)) {
          const cookie = pathname.includes('/chrome-') ? 'vcd-canvas-chrome' : 'vcd-canvas';
          res.setHeader('Set-Cookie', pathname.endsWith('on')
            ? `${cookie}=1; Path=/; SameSite=Lax`
            : `${cookie}=; Path=/; SameSite=Lax; Max-Age=0`);
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Location', canvasFlagReturnPath(req.headers, req.url));
          res.statusCode = 302;
          res.end();
          return;
        }
        if (shouldServeCanvasShell(req)) req.url = '/dev/canvas-shell';
        next();
      });
    },
  };
}
