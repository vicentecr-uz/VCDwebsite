// @ts-check
import path from 'node:path';
import { protectStaleTabWrites } from './dev-tab-state.mjs';

/** @type {number} */
let suppressUntil = 0;

const isContentPath = (file = '') =>
  /[/\\]src[/\\]content[/\\]/.test(file);

const MEDIA_ROOT = path.join(process.cwd(), 'media') + path.sep;
const isMediaPath = (file = '') => file.startsWith(MEDIA_ROOT);

const isStyleTokenPath = (file = '') =>
  /[/\\]src[/\\]styles[/\\]global\.css$/.test(file);

export function suppressContentHmr(ms = 2500) {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}

export function isContentHmrSuppressed() {
  return Date.now() <= suppressUntil;
}

export function contentHmrGate() {
  return {
    name: 'content-hmr-gate',
    apply: 'serve',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/vite/dist/client/client.mjs')) return;
      return code.replaceAll('location.reload()', "window.dispatchEvent(new Event('vcd:dev-reconnect'))");
    },
    configureServer(server) {
      server.middlewares.use(protectStaleTabWrites);
      const send = server.ws.send.bind(server.ws);
      server.ws.send = (payload, ...rest) => {
        if (
          payload
          && typeof payload === 'object'
          && payload.type === 'full-reload'
        ) {
          return;
        }
        return send(payload, ...rest);
      };
      server.middlewares.use((req, res, next) => {
        if (String(req.headers.accept || '').includes('text/html')) {
          res.setHeader('Cache-Control', 'no-store');
        }
        next();
      });
    },
    /**
     * @param {{ file: string }} ctx
     */
    handleHotUpdate({ file }) {
      if (isMediaPath(file) || isContentPath(file)) return [];
      if (isContentHmrSuppressed() && isStyleTokenPath(file)) return [];
    },
  };
}
