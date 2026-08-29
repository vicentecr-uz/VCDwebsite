// @ts-check
import path from 'node:path';

/** @type {number} */
let suppressUntil = 0;

const isContentPath = (file = '') =>
  /[/\\]src[/\\]content[/\\](projects|pages)[/\\]/.test(file);

/** Anchored to the repo root's `media/` — a bare `media` regex would also
 *  match an unrelated `media/` directory under node_modules. */
const MEDIA_ROOT = path.join(process.cwd(), 'media') + path.sep;
const isMediaPath = (file = '') => file.startsWith(MEDIA_ROOT);

/** Colour-token Saves write this file; the live preview already matches. */
const isStyleTokenPath = (file = '') =>
  /[/\\]src[/\\]styles[/\\]global\.css$/.test(file);

/**
 * Skip module invalidation briefly after API writes where the in-page
 * editor already shows the right pixels (colour-token Saves to global.css).
 * Full-reload is blocked always by contentHmrGate — this only covers HMR
 * `update` invalidation for paths that still get watched.
 */
export function suppressContentHmr(ms = 2500) {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}

export function isContentHmrSuppressed() {
  return Date.now() <= suppressUntil;
}

/**
 * Calm HMR: full browser reloads are opt-in (manual), not the default.
 *
 * Vite/Astro's safe default is "when in doubt, full-reload". That drops
 * `is-dev-mode` / the save bar and surprises mid-edit when branch sync
 * pulls engine or content files. Here we:
 *   1. Drop every `full-reload` WebSocket payload.
 *   2. Skip hot-update for content JSON / media (not modules).
 *   3. Still allow normal HMR `update` for .astro / .css / .ts.
 *
 * Server restarts (astro.config / package.json changes) are unchanged —
 * those restart the process, not a WS message.
 */
export function contentHmrGate() {
  return {
    name: 'content-hmr-gate',
    apply: 'serve',
    configureServer(server) {
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
      // Zen/Firefox Back restores the in-memory Home from before Create.
      // no-store keeps that document out of bfcache so Back is a real GET
      // (disk already has the new listing — a manual reload already proved it).
      return () => {
        server.middlewares.use((req, res, next) => {
          if (String(req.headers.accept || '').includes('text/html')) {
            res.setHeader('Cache-Control', 'no-store');
          }
          next();
        });
      };
    },
    /**
     * @param {{ file: string }} ctx
     */
    handleHotUpdate({ file }) {
      // Media + content JSON: served/read outside the module graph.
      // Branch sync / Save writing these must not invalidate modules.
      if (isMediaPath(file) || isContentPath(file)) return [];
      // Colour-token Save already applied live — skip CSS HMR flash.
      if (isContentHmrSuppressed() && isStyleTokenPath(file)) return [];
      // .astro / CSS / TS: let Vite HMR update proceed (no full-reload).
    },
  };
}
