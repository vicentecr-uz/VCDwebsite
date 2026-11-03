const SABI_HOST = 'sabi.vicentecr.uz';

type PagesContext = {
  request: Request;
  next: () => Promise<Response>;
  env: { ASSETS: { fetch: (input: URL | Request) => Promise<Response> } };
};

/**
 * Cloudflare Pages middleware: sabi.vicentecr.uz serves the /sabi page at its
 * root and documentation paths. Portfolio /sabi paths redirect to that host.
 */
export async function onRequest({ request, next, env }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/sabi' || url.pathname.startsWith('/sabi/')) {
    const target = new URL(url.pathname.slice('/sabi'.length) || '/', `https://${SABI_HOST}`);
    target.search = url.search;
    return Response.redirect(target.href, 301);
  }
  if (url.hostname === SABI_HOST) {
    const path = url.pathname.replace(/\/$/, '') || '/';
    if (['/', '/getting-started', '/api', '/styling'].includes(path)) {
      const asset = new URL(path === '/' ? '/sabi/' : `/sabi${path}/`, url);
      asset.search = url.search;
      return env.ASSETS.fetch(asset);
    }
  }
  return next();
}
