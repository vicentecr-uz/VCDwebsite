// @ts-check

/** @type {number} */
let suppressUntil = 0;

const isContentPath = (file = '') =>
  /[/\\]src[/\\]content[/\\](projects|drafts|pages)[/\\]/.test(file);

const isDraftMediaPath = (file = '') =>
  /[/\\]src[/\\]content[/\\]drafts[/\\]media[/\\]/.test(file);

/** Colour-token Saves write this file; the live preview already matches. */
const isStyleTokenPath = (file = '') =>
  /[/\\]src[/\\]styles[/\\]global\.css$/.test(file);

/**
 * Suppress Vite/Astro full-reloads briefly after API writes.
 * Content JSON and colour-token CSS both use this — the in-page editors already
 * show the right pixels, and a reload would drop `is-dev-mode` / the save bar.
 */
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
    configureServer(server) {
      // Astro often full-reloads content JSON even when handleHotUpdate
      // returns []. Intercept the WS payload during the suppress window.
      const send = server.ws.send.bind(server.ws);
      server.ws.send = (payload, ...rest) => {
        if (
          isContentHmrSuppressed()
          && payload
          && typeof payload === 'object'
          && payload.type === 'full-reload'
        ) {
          return;
        }
        return send(payload, ...rest);
      };
    },
    /**
     * @param {{ file: string }} ctx
     */
    handleHotUpdate({ file }) {
      // Draft uploads are served via /draft-media middleware, never imported.
      if (isDraftMediaPath(file)) return [];
      if (!isContentHmrSuppressed()) return;
      if (!isContentPath(file) && !isStyleTokenPath(file)) return;
      // In-place editors already mutated the DOM — skip module invalidation.
      return [];
    },
  };
}
