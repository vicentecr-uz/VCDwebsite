import { expect, test } from 'bun:test';
import { onRequest } from '../../functions/_middleware';
import routes from '../../public/_routes.json';

const paths = ['/', '/getting-started', '/api', '/styling'];
for (const path of paths) {
  test(`Sabi host serves ${path} from portfolio assets`, async () => {
    let fetched = '';
    const response = await onRequest({
      request: new Request(`https://sabi.vicentecr.uz${path}?test=1`),
      next: async () => new Response('next'),
      env: { ASSETS: { fetch: async input => { fetched = String(input); return new Response('asset'); } } },
    });
    expect(await response.text()).toBe('asset');
    expect(new URL(fetched).pathname).toBe(path === '/' ? '/sabi/' : `/sabi${path}/`);
    expect(new URL(fetched).search).toBe('?test=1');
    expect(routes.include.some(route => route === path || (route.endsWith('/*') && path.startsWith(route.slice(0, -1))))).toBe(true);
  });
}
test('portfolio docs redirect to Sabi with query intact', async () => {
  const response = await onRequest({ request: new Request('https://vicentecr.uz/sabi/styling?x=1'), next: async () => new Response('next'), env: { ASSETS: { fetch: async () => new Response('unexpected') } } });
  expect(response.headers.get('location')).toBe('https://sabi.vicentecr.uz/styling?x=1');
});
test('portfolio paths and unknown Sabi paths pass through', async () => {
  for (const url of ['https://vicentecr.uz/styling', 'https://sabi.vicentecr.uz/missing']) {
    const response = await onRequest({ request: new Request(url), next: async () => new Response('next'), env: { ASSETS: { fetch: async () => new Response('unexpected') } } });
    expect(await response.text()).toBe('next');
  }
});
