import { extname } from 'node:path';

const excludedPrefixes = ['/dev/', '/api/', '/src/', '/@', '/node_modules/', '/_', '/preview/', '/reports/prototypes/'];

const hasCookie = (headers, pair) => String(headers.cookie ?? '').split(';').some((cookie) => cookie.trim() === pair);

/**
 * The canvas is on unless this browser chose otherwise (docs/dev-canvas.md).
 * `vcd-canvas=1` forces it on and `vcd-canvas=0` turns it off. With no choice made it is skipped for
 * phones and automated browsers: by their request headers here, and by `vcd-canvas-skip=1`, which the
 * shell sets when it finds itself on a phone-sized screen or under WebDriver.
 */
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
          // Either answer is a choice this browser keeps; the default only applies where none was made.
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
