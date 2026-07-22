import type { APIRoute } from 'astro';
import { isViewBuild } from '../lib/views';

export const GET: APIRoute = () => {
  const body = isViewBuild()
    ? 'User-agent: *\nDisallow: /\n'
    : 'User-agent: *\nAllow: /\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
