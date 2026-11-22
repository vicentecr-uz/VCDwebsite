import { extname } from 'node:path';

const excludedPrefixes = ['/dev/', '/api/', '/src/', '/@', '/node_modules/', '/_', '/preview/', '/reports/prototypes/'];

const hasCookie = (headers, pair) => String(headers.cookie ?? '').split(';').some((cookie) => cookie.trim() === pair);

export function canvasWanted(headers) {
  if (hasCookie(headers, 'vcd-canvas=1')) return true;
  if (hasCookie(headers, 'vcd-canvas=0') || hasCookie(headers, 'vcd-canvas-skip=1')) return false;
  return headers['sec-ch-ua-mobile'] !== '?1' && !/HeadlessChrome|Mobi|Android|iPhone|iPad/.test(String(headers['user-agent'] ?? ''));
}

export function shouldServeCanvasShell({ method, url, headers }) {
  const pathname = new URL(url, 'http://localhost').pathname;
  return method === 'GET'
    && headers['sec-fetch-dest'] === 'document'
    && String(headers.accept ?? '').includes('text/html')
    && canvasWanted(headers)
    && !excludedPrefixes.some((prefix) => pathname.startsWith(prefix))
    && !extname(pathname);
}

export function canvasFlagReturnPath(headers, url = '') {
  const to = new URL(url || '/', 'http://localhost').searchParams.get('to');
  if (to && to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/dev/canvas/')) return to;
  try {
    const referer = new URL(String(headers.referer ?? ''));
    if (referer.host === headers.host && !referer.pathname.startsWith('/dev/canvas/')) return `${referer.pathname}${referer.search}${referer.hash}`;
  } catch {}
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
          res.setHeader('Set-Cookie', `${cookie}=${pathname.endsWith('on') ? 1 : 0}; Path=/; SameSite=Lax; Max-Age=31536000`);
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
