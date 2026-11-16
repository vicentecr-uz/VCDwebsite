import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Window } from 'happy-dom';
import { build } from 'vite';
import { checkProductionOutput } from '../check-production-output.mjs';
import { productionBoundary } from '../production-boundary.mjs';
import { createDebugRecordStore, debugRecordDevApi, isRecordTopic, isSameOriginRequest, recordFlagReturnPath } from '../dev-debug-record.mjs';

const clientPath = path.join(process.cwd(), 'src/lib/debugRecord.ts');

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vcd-debug-record-'));
  try { await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function serve(directory, run) {
  let handler;
  debugRecordDevApi({ directory }).configureServer({ middlewares: { use: (next) => { handler = next; } } });
  const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end('next'); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const batch = (extra = {}) => ({ topic: 'drag-jump', path: '/tapico?x=1', width: 1280, height: 720, entries: [{ t: 1, data: { step: 'down' } }], ...extra });
const lines = async (file) => (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

test('topics are slugs', () => {
  for (const topic of ['debug', 'drag-jump', 'a1']) expect(isRecordTopic(topic)).toBe(true);
  for (const topic of ['', '../secret', 'a/b', 'A', '-a', 'a.b', 'a b', 'x'.repeat(65), null, 3]) expect(isRecordTopic(topic)).toBe(false);
});

test('the flag link returns to a local path only', () => {
  expect(recordFlagReturnPath({}, '/dev/record/on?to=/tapico&topic=a')).toBe('/tapico');
  expect(recordFlagReturnPath({}, '/dev/record/on?to=//evil.example')).toBe('/');
  expect(recordFlagReturnPath({}, '/dev/record/on?to=https://evil.example')).toBe('/');
  expect(recordFlagReturnPath({}, '/dev/record/on?to=/dev/record/on')).toBe('/');
  expect(recordFlagReturnPath({ host: 'localhost:4322', referer: 'http://localhost:4322/about?a=1#b' }, '/dev/record/off')).toBe('/about?a=1#b');
  expect(recordFlagReturnPath({ host: 'localhost:4322', referer: 'http://evil.example/about' }, '/dev/record/off')).toBe('/');
});

test('only a page on the same origin may post', () => {
  expect(isSameOriginRequest({ host: 'localhost:4322', origin: 'http://localhost:4322' })).toBe(true);
  expect(isSameOriginRequest({ host: 'localhost:4322', origin: 'http://localhost:4322', 'sec-fetch-site': 'same-origin' })).toBe(true);
  expect(isSameOriginRequest({ host: 'localhost:4322', origin: 'http://localhost:4321' })).toBe(false);
  expect(isSameOriginRequest({ host: 'localhost:4322', origin: 'http://localhost:4322', 'sec-fetch-site': 'cross-site' })).toBe(false);
  expect(isSameOriginRequest({ host: 'localhost:4322', origin: 'null' })).toBe(false);
  expect(isSameOriginRequest({ host: 'localhost:4322' })).toBe(false);
});

test('batches append as JSON lines with their context', () => fixture(async (directory) => {
  const store = createDebugRecordStore({ directory });
  const file = await store.append(batch(), 'Zen/1.0');
  await store.append(batch({ entries: [{ t: 2, data: 'up' }] }), 'Zen/1.0');
  expect(file).toBe(path.join(directory, 'drag-jump.jsonl'));
  const [first, second] = await lines(file);
  expect(first).toMatchObject({ path: '/tapico?x=1', width: 1280, height: 720, userAgent: 'Zen/1.0', entries: [{ t: 1, data: { step: 'down' } }] });
  expect(Number.isNaN(Date.parse(first.at))).toBe(false);
  expect(second.entries).toEqual([{ t: 2, data: 'up' }]);
}));

test('rejects bad topics and shapes, and caps entry and file size', () => fixture(async (directory) => {
  const store = createDebugRecordStore({ directory });
  for (const body of [null, 'x', batch({ topic: '../secret' }), batch({ entries: [] }), batch({ entries: 'x' }), batch({ entries: Array(501).fill({ t: 1 }) })]) {
    await expect(store.append(body)).rejects.toMatchObject({ code: 'bad' });
  }
  const file = await store.append(batch({ width: 'wide', entries: [{ t: 7, data: 'x'.repeat(9000) }, { t: 8, data: 'ok' }] }));
  expect((await lines(file))[0]).toMatchObject({ width: null, entries: [{ t: 7, truncated: true }, { t: 8, data: 'ok' }] });

  await writeFile(file, 'x'.repeat(5 * 1024 * 1024 - 10));
  const results = await Promise.allSettled([store.append(batch()), store.append(batch())]);
  expect(results.map((result) => result.reason?.code)).toEqual(['full', 'full']);
  expect((await readFile(file, 'utf8')).length).toBe(5 * 1024 * 1024 - 10);
}));

test('HTTP contract: flag links, same-origin posts, validation and limits', () => fixture((directory) => serve(directory, async (origin) => {
  const get = (url) => fetch(`${origin}${url}`, { redirect: 'manual' });
  const post = (body, headers = { origin }) => fetch(`${origin}/api/dev-record`, { method: 'POST', headers, body });

  const on = await get('/dev/record/on?to=/tapico&topic=drag-jump');
  expect([on.status, on.headers.get('location'), on.headers.get('set-cookie'), on.headers.get('cache-control')])
    .toEqual([302, '/tapico', 'vcd-record=drag-jump; Path=/; SameSite=Lax', 'no-store']);
  expect((await get('/dev/record/on')).headers.get('set-cookie')).toBe('vcd-record=debug; Path=/; SameSite=Lax');
  const bad = await get('/dev/record/on?topic=a;%20Domain=x');
  expect([bad.status, bad.headers.get('set-cookie')]).toEqual([400, null]);
  const off = await get('/dev/record/off?to=/tapico');
  expect([off.status, off.headers.get('location'), off.headers.get('set-cookie')]).toEqual([302, '/tapico', 'vcd-record=; Path=/; SameSite=Lax; Max-Age=0']);

  expect((await get('/tapico')).status).toBe(404);
  expect((await get('/api/dev-record')).status).toBe(405);
  expect((await post(JSON.stringify(batch()), {})).status).toBe(403);
  expect((await post(JSON.stringify(batch()), { origin: 'http://evil.example' })).status).toBe(403);
  expect((await post('{bad')).status).toBe(400);
  expect((await post(JSON.stringify(batch({ topic: '../secret' })))).status).toBe(400);
  expect((await post(JSON.stringify(batch({ entries: [{ t: 1, data: 'x'.repeat(300 * 1024) }] })))).status).toBe(413);

  // sendBeacon posts a string as text/plain.
  const saved = await post(JSON.stringify(batch()), { origin, 'content-type': 'text/plain;charset=UTF-8', 'user-agent': 'Zen/1.0' });
  expect([saved.status, await saved.json()]).toEqual([200, { ok: true }]);
  expect(await lines(path.join(directory, 'drag-jump.jsonl'))).toMatchObject([{ userAgent: 'Zen/1.0', path: '/tapico?x=1', entries: [{ t: 1 }] }]);
})));

function client(cookie) {
  const window = new Window({ url: 'http://localhost:4322/tapico?x=1' });
  if (cookie) window.document.cookie = cookie;
  const beacons = [];
  const navigator = { sendBeacon: (url, body) => { beacons.push({ url, body: JSON.parse(body) }); return true; } };
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(readFileSync(clientPath, 'utf8')).replace('export function', 'function');
  const debugRecord = new Function('window', 'document', 'location', 'navigator', `${code}; return debugRecord;`)(window, window.document, window.location, navigator);
  return { window, beacons, debugRecord };
}

test('the client does nothing without the cookie or for another topic', async () => {
  for (const cookie of ['', 'vcd-record=other']) {
    const { window, beacons, debugRecord } = client(cookie);
    debugRecord('drag-jump', { step: 'down' });
    window.dispatchEvent(new window.Event('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(beacons).toEqual([]);
  }
});

test('the client batches entries and sends them when the page hides', async () => {
  const { window, beacons, debugRecord } = client('vcd-record=drag-jump');
  debugRecord('drag-jump', { step: 'down' });
  debugRecord('drag-jump', { step: 'up' });
  expect(beacons).toEqual([]);
  window.dispatchEvent(new window.Event('pagehide'));
  expect(beacons).toHaveLength(1);
  expect(beacons[0]).toMatchObject({ url: '/api/dev-record', body: { topic: 'drag-jump', path: '/tapico?x=1', width: window.innerWidth, entries: [{ data: { step: 'down' } }, { data: { step: 'up' } }] } });

  const loop = {};
  loop.self = loop;
  debugRecord('drag-jump', loop);
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(beacons).toHaveLength(2);
  expect(beacons[1].body.entries).toMatchObject([{ data: 'unserialisable entry' }]);
});

test('production replaces the recorder with an empty function', () => fixture(async (root) => {
  const entry = path.join(root, 'entry.js');
  await writeFile(entry, `import { debugRecord } from ${JSON.stringify(clientPath)};\ndebugRecord('drag-jump', { step: 'down' });\nconsole.log('public-code-remains');\n`);
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [productionBoundary()],
    build: { write: false, minify: false, rollupOptions: { input: entry } },
  });
  const code = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output).filter((item) => item.type === 'chunk').map((item) => item.code).join('\n');
  expect(code).toContain('public-code-remains');
  for (const marker of ['vcd-record', '/api/dev-record', 'sendBeacon']) expect(code).not.toContain(marker);
}));

test('the production output check rejects a recorder that shipped', () => fixture(async (root) => {
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'index.html'), '<main>Public</main>');
  await writeFile(path.join(root, 'assets/app.js'), 'document.cookie.includes("vcd-record")');
  await expect(checkProductionOutput(root)).rejects.toThrow(/assets\/app\.js: development inspector marker/);
  await writeFile(path.join(root, 'assets/app.js'), 'navigator.sendBeacon("/api/dev-record", body)');
  await expect(checkProductionOutput(root)).rejects.toThrow(/assets\/app\.js: authoring API endpoint/);
}));
