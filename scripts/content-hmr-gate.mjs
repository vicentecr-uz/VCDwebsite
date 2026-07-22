// @ts-check

/** @type {number} */
let suppressUntil = 0;

const isContentPath = (file = '') =>
  /[/\\]src[/\\]content[/\\](projects|drafts|pages)[/\\]/.test(file);

/** Suppress Vite/Astro full-reloads for content JSON briefly after API writes. */
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
      if (!isContentHmrSuppressed()) return;
      if (!isContentPath(file)) return;
      // In-place editors already mutated the DOM — skip module invalidation.
      return [];
    },
  };
}
