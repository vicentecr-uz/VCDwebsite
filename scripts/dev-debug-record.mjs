// @ts-check
/**
 * Dev-only debug recorder: a bug that reproduces only in the owner's browser is
 * recorded to a file an agent can read, with no console work for the owner.
 *
 * GET  /dev/record/on?to=/page&topic=slug — set the `vcd-record` cookie, go to the page.
 * GET  /dev/record/off                    — clear it.
 * POST /api/dev-record                    — append one batch to .debug-records/<topic>.jsonl.
 *
 * The client half is src/lib/debugRecord.ts.
 */
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const TOPIC = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ENTRIES = 500;
const MAX_ENTRY_BYTES = 8 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const isRecordTopic = (topic) => typeof topic === 'string' && TOPIC.test(topic);

/** After a flag toggle, go back to the page the link was clicked on (same host only). */
export function recordFlagReturnPath(headers, url = '') {
  // A link from outside the site has no referer: `?to=/page` names where to land.
  const to = new URL(url || '/', 'http://localhost').searchParams.get('to');
  if (to && to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/dev/record/')) return to;
  try {
    const referer = new URL(String(headers.referer ?? ''));
    if (referer.host === headers.host && !referer.pathname.startsWith('/dev/record/')) return `${referer.pathname}${referer.search}${referer.hash}`;
  } catch { /* no usable referer */ }
  return '/';
}

/** A page on this dev server posting to itself; another site's page (or a no-origin client) is refused. */
export function isSameOriginRequest(headers) {
  const site = headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  try { return new URL(String(headers.origin ?? '')).host === headers.host; }
  catch { return false; }
}

const fail = (code, message) => Object.assign(new Error(message), { code });

export function createDebugRecordStore({ directory = path.join(process.cwd(), '.debug-records') } = {}) {
  let queue = Promise.resolve();
  const append = async (body, userAgent) => {
    if (!body || typeof body !== 'object' || !isRecordTopic(body.topic) || !Array.isArray(body.entries) || !body.entries.length || body.entries.length > MAX_ENTRIES) {
      throw fail('bad', 'Invalid recording.');
    }
    const number = (value) => (Number.isFinite(value) ? value : null);
    const line = `${JSON.stringify({
      at: new Date().toISOString(),
      path: String(body.path ?? '').slice(0, 2048),
      width: number(body.width),
      height: number(body.height),
      userAgent: String(userAgent ?? '').slice(0, 512),
      entries: body.entries.map((entry) => (
        Buffer.byteLength(JSON.stringify(entry) ?? '') > MAX_ENTRY_BYTES ? { t: number(entry?.t), truncated: true } : entry
      )),
    })}\n`;
    const file = path.join(directory, `${body.topic}.jsonl`);
    const size = await stat(file).then((stats) => stats.size, () => 0);
    if (size + Buffer.byteLength(line) > MAX_FILE_BYTES) throw fail('full', 'Recording file is full.');
    await mkdir(directory, { recursive: true });
    await appendFile(file, line);
    return file;
  };
  return {
    // Serialised so two batches cannot both pass the size check and overrun the cap.
    append: (body, userAgent) => (queue = queue.then(() => append(body, userAgent), () => append(body, userAgent))),
  };
}

const send = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
};

export function debugRecordDevApi(options) {
  const store = createDebugRecordStore(options);
  return {
    name: 'vcd-dev-debug-record',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (req.method === 'GET' && (url.pathname === '/dev/record/on' || url.pathname === '/dev/record/off')) {
          const topic = url.searchParams.get('topic') ?? 'debug';
          if (url.pathname.endsWith('/on') && !isRecordTopic(topic)) return send(res, 400, { error: 'Invalid topic.' });
          res.setHeader('Set-Cookie', url.pathname.endsWith('/on')
            ? `vcd-record=${topic}; Path=/; SameSite=Lax`
            : 'vcd-record=; Path=/; SameSite=Lax; Max-Age=0');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Location', recordFlagReturnPath(req.headers, req.url));
          res.statusCode = 302;
          res.end();
          return;
        }
        if (url.pathname !== '/api/dev-record') return next();
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          return send(res, 405, { error: 'Method not allowed.' });
        }
        if (!isSameOriginRequest(req.headers)) return send(res, 403, { error: 'Same-origin requests only.' });
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size <= MAX_BODY_BYTES) chunks.push(chunk);
        });
        req.on('error', () => send(res, 400, { error: 'Invalid recording.' }));
        req.on('end', async () => {
          if (size > MAX_BODY_BYTES) return send(res, 413, { error: 'Recording batch is too large.' });
          try {
            await store.append(JSON.parse(Buffer.concat(chunks).toString('utf8')), req.headers['user-agent']);
            send(res, 200, { ok: true });
          } catch (error) {
            if (error?.code === 'full') send(res, 413, { error: error.message });
            else if (error?.code === 'bad' || error instanceof SyntaxError) send(res, 400, { error: 'Invalid recording.' });
            else send(res, 500, { error: 'Could not write the recording.' });
          }
        });
      });
    },
  };
}
