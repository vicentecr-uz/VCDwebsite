import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createComponentNotesStore, componentNotesDevApi } from '../dev-component-notes.mjs';

const readDocument = async (key) => key === 'sabi' ? { sections: [{ id: 'one' }, { id: 'two' }] } : null;
const payload = (extra = {}) => ({ document: 'sabi', sectionId: 'one', text: 'Adjust framing', revision: 0, ...extra });
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vcd-notes-'));
  try { await run(directory, createComponentNotesStore({ directory, readDocument })); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('notes survive a fresh store and reordered blocks without changing content', () => fixture(async (directory, store) => {
  await store.set(payload());
  const reloaded = createComponentNotesStore({ directory, readDocument: async () => ({ sections: [{ id: 'two' }, { id: 'one' }] }) });
  expect((await reloaded.get('sabi')).notes.one).toEqual({ text: 'Adjust framing', revision: 1 });
}));

test('concurrent same-block writes conflict and independent block notes are preserved', () => fixture(async (_, store) => {
  const results = await Promise.allSettled([store.set(payload()), store.set(payload({ text: 'Other device' }))]);
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  expect(results[1].reason.code).toBe('conflict');
  expect(results[1].reason.current.text).toBe('Adjust framing');
  await Promise.all([store.set(payload({ revision: 1, text: 'Updated' })), store.set(payload({ sectionId: 'two', text: 'Second' }))]);
  expect((await store.get('sabi')).notes).toEqual({ one: { text: 'Updated', revision: 2 }, two: { text: 'Second', revision: 1 } });
}));

test('clearing retains a revision tombstone and rejects an old device write', () => fixture(async (_, store) => {
  await store.set(payload());
  expect(await store.set(payload({ text: '', revision: 1 }))).toEqual({ text: '', revision: 2 });
  await expect(store.set(payload({ revision: 1 }))).rejects.toMatchObject({ code: 'conflict' });
}));

test('rejects unknown documents, blocks, unsafe keys and invalid note values', () => fixture(async (_, store) => {
  await expect(store.get('missing')).rejects.toMatchObject({ code: 'notfound' });
  await expect(store.set(payload({ sectionId: 'missing' }))).rejects.toMatchObject({ code: 'notfound' });
  for (const value of [null, payload({ document: '../secret' }), payload({ sectionId: '__proto__' }), payload({ text: 'x'.repeat(8001) }), payload({ revision: -1 }), payload({ revision: 0.5 }), payload({ revision: Number.MAX_SAFE_INTEGER })]) {
    await expect(store.set(value)).rejects.toMatchObject({ code: 'bad' });
  }
}));

test('malformed or corrupt stored notes fail closed without replacing the file', () => fixture(async (directory, store) => {
  const file = path.join(directory, 'sabi.json');
  for (const content of ['{bad', '{"notes":null}', '{"notes":{"one":{"text":3,"revision":1}}}', '{"notes":{"__proto__":{"text":"x","revision":1}}}']) {
    await writeFile(file, content);
    await expect(store.get('sabi')).rejects.toMatchObject({ code: 'storage' });
    await expect(store.set(payload())).rejects.toMatchObject({ code: 'storage' });
    expect(await readFile(file, 'utf8')).toBe(content);
  }
}));

test('write failures reject and do not report a saved note', () => fixture(async (directory) => {
  const occupied = path.join(directory, 'occupied');
  await writeFile(occupied, 'unchanged');
  const store = createComponentNotesStore({ directory: occupied, readDocument });
  await expect(store.set(payload())).rejects.toBeDefined();
  expect(await readFile(occupied, 'utf8')).toBe('unchanged');
}));

test('HTTP contract covers no-query save, conflict, validation, limits and cache policy', () => fixture(async (directory) => {
  let handler;
  componentNotesDevApi({ directory, readDocument }).configureServer({ middlewares: { use: (_, next) => { handler = next; } } });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/component-notes`;
  const post = (body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  try {
    const saved = await post(JSON.stringify(payload()));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ text: 'Adjust framing', revision: 1 });
    expect(saved.headers.get('cache-control')).toBe('private, no-store');
    const stale = await post(JSON.stringify(payload()));
    expect(stale.status).toBe(409);
    expect((await stale.json()).current.revision).toBe(1);
    for (const body of ['null', '[]', '{bad', '{}']) expect((await post(body)).status).toBe(400);
    expect((await post('x'.repeat(32769))).status).toBe(413);
    const unsupported = await fetch(url, { method: 'DELETE' });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get('allow')).toBe('GET, POST');
    expect(unsupported.headers.get('cache-control')).toBe('private, no-store');
    expect((await fetch(url + '?document=missing')).status).toBe(404);
    expect((await (await fetch(url + '?document=sabi')).json()).notes.one.text).toBe('Adjust framing');
  } finally { await new Promise((resolve) => server.close(resolve)); }
}));
