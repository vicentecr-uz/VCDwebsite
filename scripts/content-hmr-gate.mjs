// @ts-check

/** @type {number} */
let suppressUntil = 0;

/** Suppress Vite/Astro full-reloads for content JSON briefly after API writes. */
export function suppressContentHmr(ms = 1200) {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}

export function contentHmrGate() {
  return {
    name: 'content-hmr-gate',
    apply: 'serve',
    /**
     * @param {{ file: string }} ctx
     */
    handleHotUpdate({ file }) {
      if (Date.now() > suppressUntil) return;
      if (!/[/\\]src[/\\]content[/\\](projects|views|drafts|pages)[/\\]/.test(file)) return;
      // In-place editors already mutated the DOM — skip full page reload.
      return [];
    },
  };
}
