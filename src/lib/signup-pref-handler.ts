export type SignupPrefChoice = 'current' | 'throw';

export type SignupPrefVote = {
  id: string;
  at: string;
  choice: SignupPrefChoice;
  why: string;
  order: SignupPrefChoice[];
};

export type SignupPrefStore = {
  add: (vote: SignupPrefVote) => Promise<void>;
  list: () => Promise<SignupPrefVote[]>;
};

export type SignupPrefHandlerOptions = {
  isDev?: boolean;
  resultsKey?: string;
};

const MAX_BODY_BYTES = 8192;
const MAX_WHY = 2000;
const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const PROD_ORIGINS = new Set([
  'https://vicentecr.uz',
  'https://wip.vcruzdesigns.com',
]);

const memoryRates = new Map<string, { count: number; resetAt: number }>();

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

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
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && url.hostname.endsWith('.pages.dev')) return true;
    if (url.protocol === 'https:' && url.hostname.endsWith('.vcruzdesigns.com')) return true;
    if (!isDev) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isLanOrLocalHost(url.hostname);
  } catch {
    return false;
  }
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

function parseChoice(raw: unknown): SignupPrefChoice | null {
  return raw === 'current' || raw === 'throw' ? raw : null;
}

function parseOrder(raw: unknown): SignupPrefChoice[] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const first = parseChoice(raw[0]);
  const second = parseChoice(raw[1]);
  if (!first || !second || first === second) return null;
  return [first, second];
}

function tally(votes: SignupPrefVote[]) {
  let current = 0;
  let throwFirst = 0;
  for (const vote of votes) {
    if (vote.choice === 'current') current += 1;
    else throwFirst += 1;
  }
  return { current, throw: throwFirst, total: votes.length };
}

function resultsAuthorized(
  request: Request,
  isDev: boolean,
  resultsKey: string | undefined,
): boolean {
  if (isDev && !resultsKey) return true;
  if (!resultsKey) return false;
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('key');
  const auth = request.headers.get('authorization');
  const fromHeader = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : '';
  return fromQuery === resultsKey || fromHeader === resultsKey;
}

export const handleSignupPrefRequest = async (
  request: Request,
  store: SignupPrefStore,
  options: SignupPrefHandlerOptions = {},
): Promise<Response> => {
  const isDev = Boolean(options.isDev);
  if (!isAllowedOrigin(request, isDev)) {
    return json(403, { error: 'Forbidden.' });
  }
  if (request.method === 'GET') {
    if (!resultsAuthorized(request, isDev, options.resultsKey)) {
      return json(401, { error: 'Forbidden.' });
    }
    const votes = await store.list();
    votes.sort((a, b) => a.at.localeCompare(b.at));
    return json(200, { ...tally(votes), votes });
  }
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }
  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_BODY_BYTES) {
    return json(400, { error: 'That note is too long.' });
  }
  if (!memoryRateLimit(clientIp(request))) {
    return json(429, { error: 'Try again later.' });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Pick a version first.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { error: 'Pick a version first.' });
  }
  const record = body as Record<string, unknown>;
  const choice = parseChoice(record.choice);
  const order = parseOrder(record.order);
  const why = typeof record.why === 'string' ? record.why.trim() : '';
  if (!choice) return json(400, { error: 'Pick a version first.' });
  if (!order) return json(400, { error: 'Pick a version first.' });
  if (why.length > MAX_WHY) return json(400, { error: 'That note is too long.' });
  const vote: SignupPrefVote = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    choice,
    why,
    order,
  };
  try {
    await store.add(vote);
  } catch {
    return json(503, { error: 'Preferences are not stored on this host yet.' });
  }
  return json(200, { ok: true });
};
