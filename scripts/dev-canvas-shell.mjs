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

export function devCanvasShell() {
  return {
    name: 'vcd-dev-canvas-shell',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (req.method === 'GET' && (pathname === '/dev/canvas/on' || pathname === '/dev/canvas/off')) {
          res.setHeader('Set-Cookie', pathname.endsWith('/on')
            ? 'vcd-canvas=1; Path=/; SameSite=Lax'
            : 'vcd-canvas=; Path=/; SameSite=Lax; Max-Age=0');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Location', '/');
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
