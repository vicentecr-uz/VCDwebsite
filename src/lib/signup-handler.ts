import tlds from 'tlds';

/** Env bindings for listmonk (Pages `env` or Node process/.dev.vars). */
export type SignupEnv = {
  LISTMONK_URL?: string;
  LISTMONK_API_USER?: string;
  LISTMONK_API_TOKEN?: string;
  LISTMONK_LIST_ID?: string;
};

export type SignupHandlerOptions = {
  /** Allow localhost / LAN origins (astro-dev only). */
  isDev?: boolean;
};

const MAX_BODY_BYTES = 4096;
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const PROD_ORIGINS = new Set([
  'https://vicentecr.uz',
]);

// Match ProjectSignup.astro: HTML email type + tlds package (via URL hostname).
const HTML_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const VALID_TLDS = new Set(tlds.map((tld) => new URL(`https://${tld}`).hostname));

const memoryRates = new Map<string, { count: number; resetAt: number }>();

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const unavailable = () => json(503, { error: 'Signup is not available yet.' });
const badGateway = () => json(502, { error: 'Signup is not available yet.' });

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || 'unknown'
  );
}

function isLanOrLocalHost(hostname: string): boolean {
  if (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
  ) return true;
  if (hostname.endsWith('.local')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

function originFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(request: Request, isDev: boolean): boolean {
  const origin = request.headers.get('origin');
  const candidate = origin || originFromReferer(request.headers.get('referer'));
  if (!candidate) return false;
  if (PROD_ORIGINS.has(candidate)) return true;
  if (!isDev) return false;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isLanOrLocalHost(url.hostname);
  } catch {
    return false;
  }
}

/** Same copy as ProjectSignup.astro client validation. */
export function validateSignupEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Enter a valid email address.';
  const email = raw.trim();
  if (!email || !HTML_EMAIL.test(email)) return 'Enter a valid email address.';
  const tld = email.split('.').at(-1)?.toLowerCase();
  if (!tld || !VALID_TLDS.has(tld)) {
    return 'Enter an email with a recognized TLD (like .com, .net, .org, etc...)';
  }
  return null;
}

function memoryRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = memoryRates.get(ip);
  if (!entry || entry.resetAt <= now) {
    memoryRates.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

function getCache(): Cache | null {
  try {
    const stores = (globalThis as typeof globalThis & { caches?: CacheStorage }).caches;
    if (!stores) return null;
    // Cloudflare Workers expose caches.default; browsers use caches.open.
    const def = (stores as CacheStorage & { default?: Cache }).default;
    return def ?? null;
  } catch {
    return null;
  }
}

async function allowRequest(ip: string): Promise<boolean> {
  const cache = getCache();
  if (!cache) return memoryRateLimit(ip);

  const key = new Request(`https://signup-rate.internal/${encodeURIComponent(ip)}`);
  try {
    const hit = await cache.match(key);
    if (hit) {
      const data = await hit.json() as { count?: number };
      const count = typeof data.count === 'number' ? data.count : 0;
      if (count >= RATE_LIMIT_MAX) return false;
      const next = count + 1;
      const remaining = hit.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1];
      const maxAge = remaining ? Number(remaining) : Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
      await cache.put(
        key,
        new Response(JSON.stringify({ count: next }), {
          headers: {
            'content-type': 'application/json',
            'Cache-Control': `max-age=${Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 600}`,
          },
        }),
      );
      return true;
    }

    await cache.put(
      key,
      new Response(JSON.stringify({ count: 1 }), {
        headers: {
          'content-type': 'application/json',
          'Cache-Control': `max-age=${Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)}`,
        },
      }),
    );
    return true;
  } catch {
    return memoryRateLimit(ip);
  }
}

function readSignupEnv(env: SignupEnv | null | undefined) {
  const url = env?.LISTMONK_URL?.trim();
  const user = env?.LISTMONK_API_USER?.trim();
  const token = env?.LISTMONK_API_TOKEN?.trim();
  const listIdRaw = env?.LISTMONK_LIST_ID?.trim();
  if (!url || !user || !token || !listIdRaw) return null;
  const listId = Number(listIdRaw);
  if (!Number.isFinite(listId)) return null;
  return {
    baseUrl: url.replace(/\/+$/, ''),
    user,
    token,
    listId,
  };
}

function basicAuthHeader(user: string, token: string): string {
  const raw = `${user}:${token}`;
  if (typeof Buffer !== 'undefined') {
    return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
  }
  return `Basic ${btoa(raw)}`;
}

function isDuplicateSubscriber(status: number, bodyText: string): boolean {
  if (status === 409) return true;
  const lower = bodyText.toLowerCase();
  return (
    lower.includes('already exists')
    || lower.includes('subscriber already')
    || lower.includes('duplicate')
  );
}

async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false };
  if (!text.trim()) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Shared signup POST handler for Cloudflare Pages Functions and local Vite middleware.
 */
export async function handleSignupRequest(
  request: Request,
  env: SignupEnv | null | undefined,
  options: SignupHandlerOptions = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  const isDev = options.isDev === true;
  if (!isAllowedOrigin(request, isDev)) {
    return json(403, { error: 'Forbidden.' });
  }

  const ip = clientIp(request);
  if (!(await allowRequest(ip))) {
    return json(429, { error: 'Too many requests. Try again later.' });
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return json(400, { error: 'Enter a valid email address.' });
  }

  const emailError = validateSignupEmail((parsed.value as { email?: unknown }).email);
  if (emailError) return json(400, { error: emailError });

  const email = String((parsed.value as { email: string }).email).trim();
  const config = readSignupEnv(env);
  if (!config) return unavailable();

  let listmonkResponse: Response;
  try {
    listmonkResponse = await fetch(`${config.baseUrl}/api/subscribers`, {
      method: 'POST',
      headers: {
        authorization: basicAuthHeader(config.user, config.token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        status: 'enabled',
        lists: [config.listId],
      }),
    });
  } catch {
    return badGateway();
  }

  if (listmonkResponse.ok) return json(200, { ok: true });

  let bodyText = '';
  try {
    bodyText = await listmonkResponse.text();
  } catch {
    bodyText = '';
  }

  if (isDuplicateSubscriber(listmonkResponse.status, bodyText)) {
    return json(200, { ok: true });
  }

  if (listmonkResponse.status >= 500 || listmonkResponse.status === 0) {
    return badGateway();
  }

  // Unexpected 4xx from listmonk — do not leak internals.
  return badGateway();
}
