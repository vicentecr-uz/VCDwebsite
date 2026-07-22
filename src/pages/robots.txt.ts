import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const body = 'User-agent: *\nAllow: /\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
