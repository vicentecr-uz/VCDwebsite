/**
 * Site drawing owns the page while it is not idle: every hover- or
 * proximity-revealed editor control stands down so it never lands under the pen.
 *
 *   idle ──menu-open──▶ menu ──menu-close──▶ idle
 *   idle | menu ──stage-open──▶ drawing ──stage-close──▶ idle
 *
 * `drawing` ignores menu events, so closing the manage menu while the stage
 * opens can't drop the page back to idle mid-stroke.
 */
export type SiteDrawMode = 'idle' | 'menu' | 'drawing';
export type SiteDrawEvent = 'menu-open' | 'menu-close' | 'stage-open' | 'stage-close';

export const SITE_DRAW_MODE_ATTR = 'data-site-draw-mode';

export const nextSiteDrawMode = (mode: SiteDrawMode, event: SiteDrawEvent): SiteDrawMode => {
  switch (event) {
    case 'menu-open': return mode === 'idle' ? 'menu' : mode;
    case 'menu-close': return mode === 'menu' ? 'idle' : mode;
    case 'stage-open': return 'drawing';
    case 'stage-close': return mode === 'drawing' ? 'idle' : mode;
  }
};

export const siteDrawMode = (root = document.documentElement): SiteDrawMode =>
  (root.getAttribute(SITE_DRAW_MODE_ATTR) as SiteDrawMode | null) ?? 'idle';

export const sendSiteDrawEvent = (event: SiteDrawEvent, root = document.documentElement) => {
  const previous = siteDrawMode(root);
  const next = nextSiteDrawMode(previous, event);
  if (next === previous) return;
  if (next === 'idle') root.removeAttribute(SITE_DRAW_MODE_ATTR);
  else root.setAttribute(SITE_DRAW_MODE_ATTR, next);
  if (previous !== 'idle') return;
  const { ownerDocument } = root;
  ownerDocument.dispatchEvent(new (ownerDocument.defaultView?.Event ?? Event)('dev:clear-gap-proximity'));
};
