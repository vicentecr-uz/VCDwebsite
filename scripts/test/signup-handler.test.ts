import { expect, test } from 'bun:test';
import { handleSignupRequest } from '../../src/lib/signup-handler';

const request = (forwardedFor: string) => new Request('https://vicentecr.uz/api/signup', {
  method: 'POST',
  headers: {
    origin: 'https://vicentecr.uz',
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.7',
    'x-forwarded-for': `${forwardedFor}, 203.0.113.7`,
  },
  body: JSON.stringify({ email: 'a@example.com' }),
});

test('rate limit keys on the Cloudflare client IP, not a spoofable X-Forwarded-For', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) statuses.push((await handleSignupRequest(request(`198.51.100.${i}`), {})).status);
  expect(statuses.slice(0, 8).includes(429)).toBe(false);
  expect(statuses.slice(8)).toEqual([429, 429]);
});
