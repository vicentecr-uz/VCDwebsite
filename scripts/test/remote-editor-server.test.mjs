import { test, beforeEach, afterEach } from 'bun:test';
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
  assert.equal((await request(port, '/../package.json')).status, 404);
  assert.equal((await request(port, '/%2e%2e/package.json')).status, 404);
  await fs.symlink('/etc/passwd', path.join(root, 'leak.txt'));
  assert.equal((await request(port, '/leak.txt')).status, 404);
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

test('rejects expired and future signed cookies, missing origin, and unsafe hosts', async () => {
  const port = gateway.server.address().port;
  const now = Math.floor(Date.now() / 1000);
  const signed = (time) => {
    const value = `${time}.${'a'.repeat(24)}`;
    return `__Host-vcd_editor=${value}.${crypto.createHmac('sha256', secret).update(value).digest('base64url')}`;
  };
  for (const time of [now - 30 * 24 * 60 * 60, now + 3600]) {
    assert.equal((await request(port, '/api/content-text', { headers: { cookie: signed(time) } })).status, 401);
  }
  assert.equal((await request(port, '/api/remote-editor/login', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await request(port, '/', { headers: { host: 'localhost' } })).status, 404);
  const { cookie } = await login(port);
  assert.equal((await request(port, '/anything', { method: 'POST', headers: { cookie }, body: '{}' })).status, 403);
  assert.equal((await request(port, '/api/style-token-commit', { method: 'POST', headers: { cookie, origin: 'https://edit.example.test' }, body: '{}' })).status, 403);
});

test('serves public nested pages, missing draft fallback and HEAD without private source', async () => {
  const port = gateway.server.address().port;
  await fs.mkdir(path.join(root, 'about'));
  await fs.writeFile(path.join(root, 'about/index.html'), '<h1>About</h1>');
  assert.equal(await (await request(port, '/about')).text(), '<h1>About</h1>');
  assert.equal(await (await request(port, '/unpublished-draft?login')).text(), '<h1>Public</h1>');
  for (const route of ['/src/secrets', '/scripts/deploy', '/@fs/etc/passwd', '/.env', '/api']) {
    const response = await request(port, route);
    assert.ok([401, 404].includes(response.status), route);
    assert.doesNotMatch(await response.text(), /Public|upstream/);
  }
  const response = await request(port, '/', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('concurrent guesses cannot bypass the per-client limit; oversized login is rejected', async () => {
  const port = gateway.server.address().port;
  const guesses = await Promise.all(Array.from({ length: 10 }, () => request(port, '/api/remote-editor/login', { method: 'POST', headers: { origin: 'https://edit.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })));
  assert.equal(guesses.filter((response) => response.status === 401).length, 5);
  assert.equal(guesses.filter((response) => response.status === 429).length, 5);
  const response = await request(port, '/api/remote-editor/login', { method: 'POST', headers: { origin: 'https://edit.example.test', 'cf-connecting-ip': '192.0.2.1' }, body: 'x'.repeat(5000) });
  assert.equal(response.status, 413);
});

test('authenticated upgrade still requires exact origin', async () => {
  const port = gateway.server.address().port;
  const { cookie } = await login(port);
  for (const origin of ['', 'https://evil.test']) {
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET / HTTP/1.1\r\nHost: edit.example.test\r\nCookie: ${cookie}\r\n${origin ? `Origin: ${origin}\r\n` : ''}Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
      socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('Upgrade did not respond')); });
      socket.once('data', (data) => { resolve(data.toString()); socket.destroy(); });
    });
    assert.match(result, /401 Unauthorized/);
  }
});

test('authenticated requests strip credentials and survive upstream failure', async () => {
  const port = gateway.server.address().port;
  const { cookie } = await login(port);
  upstream.removeAllListeners('request');
  upstream.on('request', (req, res) => res.end(JSON.stringify({ cookie: req.headers.cookie, authorization: req.headers.authorization, url: req.url })));
  const response = await request(port, '/api/content-text?q=one', { method: 'POST', headers: { cookie, authorization: 'Basic hidden', origin: 'https://edit.example.test' }, body: '{}' });
  assert.deepEqual(await response.json(), { url: '/api/content-text?q=one' });
  assert.equal((await request(port, '/api/%2570ublish', { method: 'POST', headers: { cookie, origin: 'https://edit.example.test' }, body: '{}' })).status, 400);
  await new Promise((resolve) => upstream.close(resolve));
  assert.equal((await request(port, '/api/content-text', { headers: { cookie } })).status, 502);
});
