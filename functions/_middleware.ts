const SABI_HOST = 'sabi.vicentecr.uz';

type PagesContext = {
  request: Request;
  next: () => Promise<Response>;
  env: { ASSETS: { fetch: (input: URL | Request) => Promise<Response> } };
};

/**
 * Cloudflare Pages middleware: sabi.vicentecr.uz serves the /sabi page at its
 * root, and any /sabi path on either host redirects there. public/_routes.json
 * limits this to /, /sabi and /sabi/* (plus /api/*), so other requests skip it.
 */
export async function onRequest({ request, next, env }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/sabi' || url.pathname.startsWith('/sabi/')) {
    const target = new URL(url.pathname.slice('/sabi'.length) || '/', `https://${SABI_HOST}`);
    target.search = url.search;
    return Response.redirect(target.href, 301);
  }
  if (url.hostname === SABI_HOST && url.pathname === '/') {
    return env.ASSETS.fetch(new URL('/sabi/', url));
  }
  return next();
}
