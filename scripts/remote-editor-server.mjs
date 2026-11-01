import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const MAX_BODY = 4096;
const SESSION_TTL = 30 * 24 * 60 * 60;
const MUTATING_BLOCK = ['/api/publish', '/api/publish-styles', '/api/commit-engine', '/api/style-token', '/api/dev-branch-update'];

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(body);
}
function json(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', ...headers });
}
function commonHeaders() {
  return { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' };
}
function constantEqual(a, b) {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function parseCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const pair of raw.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let tooLarge = false;
    req.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) tooLarge = true; else chunks.push(chunk); });
    req.on('end', () => tooLarge ? reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' })) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.avif': 'image/avif', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' })[ext] || 'application/octet-stream';
}

export function createRemoteEditorServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 4831);
  const publicHost = options.publicHost || 'edit.vicentecr.uz';
  const staticDir = options.staticDir ? path.resolve(options.staticDir) : null;
  const upstream = new URL(options.upstream || 'http://127.0.0.1:4830');
  if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(upstream.hostname)) throw new Error('upstream must be loopback http');
  const sessionSecret = Buffer.from(String(options.sessionSecret || ''), 'utf8');
  const passwordHash = String(options.passwordHash || '');
  const rate = new Map(); // Bounded in-memory ceiling; replace with shared storage if the gateway is scaled.
  let hashParts = null;
  if (passwordHash) {
    const match = passwordHash.match(/^scrypt\$([^$]+)\$([0-9a-f]{128})$/);
    if (!match) throw new Error('passwordHash must be scrypt$salt$hex64bytes');
    hashParts = { salt: match[1], digest: Buffer.from(match[2], 'hex') };
  }
  if (sessionSecret.length < 32) throw new Error('sessionSecret must be at least 32 bytes');
  if (!hashParts) throw new Error('passwordHash is required');

  function hostAllowed(req) {
    const value = String(req.headers.host || '').split(':')[0].toLowerCase();
    return value === publicHost.toLowerCase();
  }
  function csrfAllowed(req) {
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && origin !== `https://${publicHost}`) return false;
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
    return origin === `https://${publicHost}` || ['GET', 'HEAD', 'OPTIONS'].includes(req.method || '');
  }
  function sessionCookie(value) {
    const mac = crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
    return `${value}.${mac}`;
  }
  function validSession(cookie) {
    if (!cookie) return false;
    const at = cookie.lastIndexOf('.'); if (at < 1) return false;
    const value = cookie.slice(0, at); const sig = cookie.slice(at + 1);
    if (!constantEqual(sig, crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url'))) return false;
    const timestamp = Number(value.split('.')[0]);
    const now = Math.floor(Date.now() / 1000);
    return Number.isFinite(timestamp) && timestamp <= now && timestamp > now - SESSION_TTL;
  }
  async function passwordMatches(password) {
    if (!hashParts || typeof password !== 'string' || Buffer.byteLength(password) > 1024) return false;
    const derived = await new Promise((resolve, reject) => crypto.scrypt(password, hashParts.salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
    return crypto.timingSafeEqual(derived, hashParts.digest);
  }
  function clientKey(req) { return String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown'); }
  function limited(req) {
    const now = Date.now(); const key = clientKey(req); const item = rate.get(key);
    if (rate.size > 1000) for (const [k, v] of rate) if (v.until < now) rate.delete(k);
    if (!item || item.until < now) { rate.set(key, { count: 0, until: now + 60000 }); return false; }
    return item.count >= 5;
  }
  function failed(req) { const key = clientKey(req); const item = rate.get(key) || { count: 0, until: Date.now() + 60000 }; item.count += 1; rate.set(key, item); }
  async function serveStatic(req, res, pathname) {
    if (!staticDir || pathname.startsWith('/api/') || pathname.startsWith('/@') || pathname.includes('/node_modules') || pathname.includes('/src/') || pathname.includes('/scripts/')) return false;
    let clean; try { clean = decodeURIComponent(pathname); } catch { return false; }
    if (clean.split('/').some((part) => part === '..' || part.startsWith('.'))) return false;
    let relative = clean === '/' ? '/index.html' : clean;
    let target = path.resolve(staticDir, `.${relative}`);
    if (!target.startsWith(`${staticDir}${path.sep}`) && target !== staticDir) return false;
    let stat;
    try { stat = await fs.stat(target); } catch { stat = null; }
    if (!stat || !stat.isFile()) {
      if (path.extname(clean)) return false;
      target = path.join(staticDir, clean.replace(/\/$/, ''), 'index.html');
      try { stat = await fs.stat(target); } catch { return false; }
    }
    const rootReal = await fs.realpath(staticDir).catch(() => null); const real = await fs.realpath(target).catch(() => null);
    if (!rootReal || !real || !real.startsWith(`${rootReal}${path.sep}`)) return false;
    const data = await fs.readFile(real);
    send(res, 200, req.method === 'HEAD' ? null : data, { ...commonHeaders(), 'content-type': contentType(real) });
    return true;
  }
  function proxy(req, res, authenticated, requestPath = req.url) {
    const headers = { ...req.headers, host: upstream.host };
    delete headers.authorization; delete headers.cookie;
    const request = http.request({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, path: requestPath, method: req.method, headers }, (up) => {
      const out = { ...commonHeaders() }; for (const [k, v] of Object.entries(up.headers)) if (!['set-cookie', 'cache-control', 'x-robots-tag'].includes(k)) out[k] = v;
      res.writeHead(up.statusCode || 502, out); up.pipe(res);
    });
    request.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Editor unavailable.' }, commonHeaders()); else res.destroy(); });
    req.pipe(request);
  }
  const server = http.createServer(async (req, res) => {
    Object.entries(commonHeaders()).forEach(([key, value]) => res.setHeader(key, value));
    try {
      if (!hostAllowed(req)) return json(res, 404, { error: 'Not found' }, commonHeaders());
      const url = new URL(req.url || '/', `https://${publicHost}`); const pathname = url.pathname; let decodedPath;
      try { decodedPath = decodeURIComponent(pathname); } catch { return json(res, 400, { error: 'Invalid path.' }, commonHeaders()); }
      const routePath = path.posix.normalize(decodedPath.replace(/\/+/g, '/'));
      if (routePath === '/__open-in-editor' || routePath.startsWith('/__open-in-editor/')) return json(res, 404, { error: 'Not found' }, commonHeaders());
      const cookie = parseCookie(req, '__Host-vcd_editor'); const authenticated = validSession(cookie);
      if (routePath === '/api/remote-editor/session' && req.method === 'GET') return json(res, 200, { authenticated }, commonHeaders());
      if (routePath === '/api/remote-editor/login' && req.method === 'POST') {
        if (!csrfAllowed(req)) return json(res, 403, { error: 'Forbidden' }, commonHeaders());
        if (limited(req)) return json(res, 429, { error: 'Too many attempts.' }, commonHeaders());
        let body; try { body = await readBody(req); } catch (e) { return json(res, e.code === 'TOO_LARGE' ? 413 : 400, { error: 'Invalid request.' }, commonHeaders()); }
        let password = ''; const type = String(req.headers['content-type'] || '');
        if (type.includes('application/json')) { try { password = JSON.parse(body.toString()).password || ''; } catch {} } else password = new URLSearchParams(body.toString()).get('password') || '';
        if (!(await passwordMatches(password))) { failed(req); return json(res, 401, { error: 'Incorrect password.' }, commonHeaders()); }
        const value = `${Math.floor(Date.now() / 1000)}.${crypto.randomBytes(18).toString('base64url')}`;
        return json(res, 200, { ok: true }, { ...commonHeaders(), 'set-cookie': `__Host-vcd_editor=${sessionCookie(value)}; Max-Age=${SESSION_TTL}; Path=/; Secure; HttpOnly; SameSite=Strict` });
      }
      if (routePath === '/api/remote-editor/logout' && req.method === 'POST') { if (!csrfAllowed(req)) return json(res, 403, { error: 'Forbidden' }, commonHeaders()); return json(res, 200, { ok: true }, { ...commonHeaders(), 'set-cookie': '__Host-vcd_editor=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict' }); }
      if (routePath.startsWith('/api/')) {
        if (!authenticated) return json(res, 401, { error: 'Session expired' }, commonHeaders());
        if (!csrfAllowed(req)) return json(res, 403, { error: 'Forbidden' }, commonHeaders());
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && MUTATING_BLOCK.some((prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`))) return json(res, 403, { error: 'Publishing is disabled.' }, commonHeaders());
        return proxy(req, res, true, routePath + url.search);
      }
      if (req.headers.upgrade?.toLowerCase() === 'websocket') { if (!authenticated || !csrfAllowed(req)) return json(res, 401, { error: 'Session expired' }, commonHeaders()); return proxy(req, res, true); }
      if (authenticated) return proxy(req, res, true, routePath + url.search);
      await serveStatic(req, res, pathname) || json(res, 401, { error: 'Authentication required.' }, commonHeaders());
    } catch { if (!res.headersSent) json(res, 500, { error: 'Request failed.' }, commonHeaders()); else res.destroy(); }
  });
  server.on('upgrade', (req, socket, head) => {
    try {
      if (!hostAllowed(req) || !csrfAllowed(req) || !validSession(parseCookie(req, '__Host-vcd_editor'))) throw new Error('unauthorized');
      const headers = { ...req.headers, host: upstream.host };
      delete headers.authorization; delete headers.cookie;
      const request = http.request({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers });
      request.on('upgrade', (up, upSocket, upHead) => {
        socket.write(`HTTP/1.1 101 ${up.statusMessage || 'Switching Protocols'}\r\n`);
        for (const [key, value] of Object.entries(up.headers)) socket.write(`${key}: ${value}\r\n`);
        socket.write('\r\n');
        if (upHead?.length) socket.write(upHead);
        if (head?.length) upSocket.write(head);
        socket.pipe(upSocket).pipe(socket);
      });
      request.on('error', () => socket.destroy()); request.end();
    } catch { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); }
  });
  return { server, listen: () => new Promise((resolve) => server.listen(port, host, resolve)), close: () => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const gateway = createRemoteEditorServer({ host: process.env.VCD_EDITOR_HOST, port: process.env.VCD_EDITOR_PORT, publicHost: process.env.VCD_EDITOR_PUBLIC_HOST, staticDir: process.env.VCD_EDITOR_STATIC_DIR, upstream: process.env.VCD_EDITOR_UPSTREAM, passwordHash: process.env.VCD_EDITOR_PASSWORD_HASH, sessionSecret: process.env.VCD_EDITOR_SESSION_SECRET });
  gateway.listen();
}
