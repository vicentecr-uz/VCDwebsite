import type { APIRoute } from 'astro';

/**
 * Legacy `-old` routes render the same projects from `legacy/` components and
 * serve multi-MB originals. They stay reachable while #70 is open, but must not
 * be indexed — a duplicate of a case study competing with the real one in search
 * is worse than not being found at all. `/dev/` are build-time probes.
 */
const DISALLOW = ['/dev/', '/[retired-project]', '/[retired-project]'];

export const GET: APIRoute = () => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    ...DISALLOW.map((path) => `Disallow: ${path}`),
  ];

  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
