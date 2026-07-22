import headerSettings from '../content/settings/header.json';
import { loadViewConfig } from './views';

type MenuLink = {
  label: string;
  href: string;
};

/** Header menu links, filtered when building a tailored employer view. */
export function getMenuLinks(): MenuLink[] {
  const view = loadViewConfig();
  const allowed = view?.site?.nav;
  if (!allowed?.length) return headerSettings.menuLinks;

  const nav = new Set(allowed);
  return headerSettings.menuLinks.filter((link) => {
    if (link.href === '/work') return nav.has('work');
    if (link.href === '/play') return nav.has('play');
    if (link.href === '/about') return nav.has('about');
    return true;
  });
}

/** Whether a listing route should render on the current view build. */
export function isListingRouteEnabled(pathname: string): boolean {
  const view = loadViewConfig();
  const allowed = view?.site?.nav;
  if (!allowed?.length) return true;

  const nav = new Set(allowed);
  if (pathname === '/' || pathname === '/index.html') return nav.has('home');
  if (pathname.startsWith('/work')) return nav.has('work');
  if (pathname.startsWith('/play')) return nav.has('play');
  if (pathname.startsWith('/about')) return nav.has('about');
  return true;
}
