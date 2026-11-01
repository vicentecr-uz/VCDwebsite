import { test, describe, beforeEach, afterEach } from 'bun:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRemoteEditorServer } from '../remote-editor-server.mjs';

const password = 'phone-draft-password';
const secret = '01234567890123456789012345678901';
const hash = await new Promise((resolve, reject) => crypto.scrypt(password, 'test-salt', 64, { N: 16384, r: 8, p: 1 }, (e, key) => e ? reject(e) : resolve(`scrypt$test-salt$${key.toString('hex')}`)));
let root; let gateway; let upstream;

function request(port, route, init = {}) {
  return fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { host: 'edit.example.test', ...(init.headers || {}) } });
}
async function login(port) {
  const response = await request(port, '/api/remote-editor/login', { method: 'POST', headers: { origin: 'https://edit.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  return { response, cookie: response.headers.get('set-cookie').split(';')[0] };
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-editor-'));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Public</h1>');
  await fs.writeFile(path.join(root, 'building-sabi'), 'page');
  upstream = http.createServer((req, res) => { res.setHeader('content-type', 'text/plain'); res.end(`upstream:${req.url}`); });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  gateway = createRemoteEditorServer({ port: 0, publicHost: 'edit.example.test', staticDir: root, upstream: `http://127.0.0.1:${upstream.address().port}`, passwordHash: hash, sessionSecret: secret });
  await gateway.listen();
});
afterEach(async () => { await gateway.close(); await new Promise((resolve) => upstream.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });

test('serves static view but protects private APIs and traversal', async () => {
  const port = gateway.server.address().port;
  assert.equal((await request(port, '/')).status, 200);
  assert.equal((await request(port, '/api/content-text')).status, 401);
  assert.equal((await request(port, '/../package.json')).status, 401);
  assert.equal((await request(port, '/%2e%2e/package.json')).status, 401);
  await fs.symlink('/etc/passwd', path.join(root, 'leak.txt'));
  assert.equal((await request(port, '/leak.txt')).status, 401);
});

test('login cookie is secure, tamper resistant, expires, and enforces CSRF', async () => {
  const port = gateway.server.address().port;
  assert.equal((await request(port, '/api/remote-editor/login', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ password }) })).status, 403);
  const { response, cookie } = await login(port);
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /Secure/); assert.match(response.headers.get('set-cookie'), /HttpOnly/); assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  assert.deepEqual(await (await request(port, '/api/remote-editor/session', { headers: { cookie } })).json(), { authenticated: true });
  const bad = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a');
  assert.equal((await request(port, '/api/content-text', { headers: { cookie: bad } })).status, 401);
});

test('rate limits six failed logins while preserving static GETs', async () => {
  const port = gateway.server.address().port;
  for (let i = 0; i < 5; i++) assert.equal((await request(port, '/api/remote-editor/login', { method: 'POST', headers: { origin: 'https://edit.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })).status, 401);
  assert.equal((await request(port, '/api/remote-editor/login', { method: 'POST', headers: { origin: 'https://edit.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ password }) })).status, 429);
  assert.equal((await request(port, '/')).status, 200);
});

test('authenticated proxy blocks every normalized publish route', async () => {
  const port = gateway.server.address().port; const { cookie } = await login(port);
  for (const route of ['/api/publish', '/api//publish', '/api/%2fpublish', '/api/publish/extra']) {
    assert.equal((await request(port, route, { method: 'POST', headers: { cookie, origin: 'https://edit.example.test' }, body: '{}' })).status, 403, route);
  }
  const response = await request(port, '/api/content-text', { headers: { cookie, origin: 'https://edit.example.test' } });
  assert.equal(response.status, 200); assert.match(await response.text(), /upstream/);
});

test('unauthenticated websocket upgrade is denied', async () => {
  const port = gateway.server.address().port;
  const result = await new Promise((resolve) => { const socket = net.connect(port, '127.0.0.1', () => socket.write('GET /api/content-hmr HTTP/1.1\r\nHost: edit.example.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')); socket.once('data', (data) => { resolve(data.toString()); socket.destroy(); }); });
  assert.match(result, /401 Unauthorized/);
});
