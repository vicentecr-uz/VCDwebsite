import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeAtomicJson, readDevDocument, resolveEditableDocument } from './dev-api-plugins.mjs';

const MAX_TEXT = 8000;
const MAX_BODY = 32768;
const safeKey = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const plain = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

function validateStored(stored) {
  if (!plain(stored) || !plain(stored.notes)) throw fail('storage');
  for (const [id, note] of Object.entries(stored.notes)) {
    if (!safeKey(id) || !plain(note) || typeof note.text !== 'string' || note.text.length > MAX_TEXT
      || !Number.isSafeInteger(note.revision) || note.revision < 1) throw fail('storage');
  }
  return stored;
}

export function createComponentNotesStore({ directory, readDocument }) {
  const root = path.resolve(directory);
  let tail = Promise.resolve();
  // One dev server owns this directory; use a shared transactional store before scaling writers.
  const enqueue = (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
  async function documentData(document) {
    if (!safeKey(document)) throw fail('bad');
    let data;
    try { data = await readDocument(document); }
    catch (error) {
      if (error?.code === 'ENOENT') throw fail('notfound');
      throw error;
    }
    if (!data || !Array.isArray(data.sections)) throw fail('notfound');
    return data;
  }
  async function readStored(document) {
    try {
      return validateStored(JSON.parse(await readFile(path.join(root, `${document}.json`), 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return { notes: {} };
      if (error instanceof SyntaxError) throw fail('storage');
      throw error;
    }
  }
  const get = (document) => enqueue(async () => {
    await documentData(document);
    return readStored(document);
  });
  const set = (payload) => enqueue(async () => {
    if (!plain(payload)) throw fail('bad');
    const { document, sectionId, text, revision } = payload;
    if (!safeKey(sectionId) || typeof text !== 'string' || text.length > MAX_TEXT
      || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw fail('bad');
    const data = await documentData(document);
    if (!data.sections.some((section) => section?.id === sectionId)) throw fail('notfound');
    const stored = await readStored(document);
    const current = Object.hasOwn(stored.notes, sectionId) ? stored.notes[sectionId] : { text: '', revision: 0 };
    if (current.revision !== revision) throw fail('conflict', { current });
    const next = { text, revision: revision + 1 };
    stored.notes[sectionId] = next;
    await mkdir(root, { recursive: true });
    await writeAtomicJson(path.join(root, `${document}.json`), stored);
    return next;
  });
  return { get, set };
}

async function loadDocument(document) {
  const relative = resolveEditableDocument(document);
  if (!relative) throw fail('notfound');
  return readDevDocument(relative);
}

function response(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'private, no-store');
  res.end(JSON.stringify(payload));
}

export function componentNotesDevApi({
  directory = path.join(process.cwd(), '.dev-session/component-notes'),
  readDocument = loadDocument,
} = {}) {
  const store = createComponentNotesStore({ directory, readDocument });
  return {
    name: 'component-notes-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/component-notes', async (req, res) => {
        if (!['GET', 'POST'].includes(req.method)) {
          res.setHeader('allow', 'GET, POST');
          return response(res, 405, { error: 'Method not allowed.' });
        }
        try {
          if (req.method === 'GET') {
            const url = new URL(req.url || '/', 'http://localhost');
            return response(res, 200, await store.get(url.searchParams.get('document')));
          }
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size <= MAX_BODY) chunks.push(chunk);
          }
          if (size > MAX_BODY) return response(res, 413, { error: 'Note is too long.' });
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          return response(res, 200, await store.set(payload));
        } catch (error) {
          if (error?.code === 'conflict') return response(res, 409, { error: 'Note changed elsewhere.', current: error.current });
          if (error?.code === 'notfound') return response(res, 404, { error: 'Block not found.' });
          if (error?.code === 'bad' || error instanceof SyntaxError) return response(res, 400, { error: 'Invalid note.' });
          return response(res, 500, { error: 'Could not save note.' });
        }
      });
    },
  };
}
