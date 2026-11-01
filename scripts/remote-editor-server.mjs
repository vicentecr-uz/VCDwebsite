import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const SESSION_TTL = 30 * 24 * 60 * 60;
const MAX_BODY = 4096;
const COOKIE = '__Host-vcd_editor';
const WRITE_BLOCKS = ['/api/publish', '/api/commit-engine', '/api/style-token', '/api/dev-branch-update'];
const HEADERS = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { ...HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

function normalizedRequest(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const decoded = decodeURIComponent(url.pathname);
  if (/[\0\\]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)) throw new Error('Invalid path');
  const pathname = path.posix.normalize(decoded.replace(/\/+/g, '/'));
  return { pathname, target: encodeURI(pathname).replace(/\?/g, '%3F').replace(/#/g, '%23') + url.search };
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  }
  if (size > MAX_BODY) throw new Error('Body too large');
  return Buffer.concat(chunks).toString('utf8');
}

export function createRemoteEditorServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port ?? 4831);
  const publicHost = options.publicHost || 'edit.vicentecr.uz';
  const origin = `https://${publicHost}`;
  const staticDir = options.staticDir ? path.resolve(options.staticDir) : null;
  const upstream = new URL(options.upstream || 'http://127.0.0.1:4830');
  if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname) || upstream.username || upstream.password) throw new Error('upstream must be loopback http');
  const secret = String(options.sessionSecret || '');
  const hash = String(options.passwordHash || '').match(/^scrypt\$([^$]+)\$([0-9a-f]{128})$/);
  if (Buffer.byteLength(secret) < 32 || !hash) throw new Error('A session secret and scrypt password hash are required');
  const digest = Buffer.from(hash[2], 'hex');
  const attempts = new Map();
  let passwordChecks = 0;
  const upgradedSockets = new Set();

  const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
  const hostAllowed = (req) => String(req.headers.host || '').toLowerCase() === publicHost.toLowerCase();
  const sameOrigin = (req) => req.headers.origin === origin && req.headers['sec-fetch-site'] !== 'cross-site';
  const mutating = (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  function authenticated(req) {
    const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const match = cookie?.match(/^(\d{1,12})\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/);
    if (!match) return false;
    const now = Math.floor(Date.now() / 1000);
    const issued = Number(match[1]);
    return issued <= now && issued > now - SESSION_TTL && crypto.timingSafeEqual(Buffer.from(match[3]), Buffer.from(sign(`${match[1]}.${match[2]}`)));
  }
  function reserveAttempt(req) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress);
    // At most 1,000 client buckets and 8 password checks; use shared limits if scaled beyond one process.
    if ((!attempts.has(key) && attempts.size >= 1000) || passwordChecks >= 8) return null;
    const entry = attempts.get(key) || { count: 0, until: now + 60_000 };
    if (entry.count >= 5) return null;
    entry.count++;
    attempts.set(key, entry);
    return entry;
  }
  async function login(req, res) {
    const attempt = reserveAttempt(req);
    if (!attempt) return json(res, 429, { error: 'Too many attempts. Try again later.' }, { 'retry-after': '60' });
    let raw;
    try { raw = await body(req); } catch { return json(res, 413, { error: 'Request too large.' }); }
    let password;
    try {
      password = String(req.headers['content-type'] || '').startsWith('application/json') ? JSON.parse(raw).password : new URLSearchParams(raw).get('password');
    } catch { return json(res, 400, { error: 'Invalid request.' }); }
    if (typeof password !== 'string' || Buffer.byteLength(password) > 1024) return json(res, 400, { error: 'Invalid password.' });
    if (passwordChecks >= 8) return json(res, 429, { error: 'Too many attempts. Try again later.' });
    passwordChecks++;
    let valid;
    try {
      const derived = await new Promise((resolve, reject) => crypto.scrypt(password, hash[1], 64, (error, key) => error ? reject(error) : resolve(key)));
      valid = crypto.timingSafeEqual(derived, digest);
    } finally { passwordChecks--; }
    if (!valid) return json(res, 401, { error: 'Incorrect password' });
    attempt.count = 0;
    const value = `${Math.floor(Date.now() / 1000)}.${crypto.randomBytes(18).toString('base64url')}`;
    return json(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=${value}.${sign(value)}; Max-Age=${SESSION_TTL}; Path=/; Secure; HttpOnly; SameSite=Strict` });
  }
  async function serveStatic(req, res, pathname) {
    if (!staticDir || !['GET', 'HEAD'].includes(req.method)) return false;
    if (/^\/(?:api(?:\/|$)|@|node_modules(?:\/|$)|src(?:\/|$)|scripts(?:\/|$))/.test(pathname) || pathname.split('/').some((part) => part.startsWith('.'))) return false;
    const root = await fs.realpath(staticDir);
    let candidate = path.resolve(root, `.${pathname}`);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) return false;
    let stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isDirectory()) {
      candidate = path.join(candidate, 'index.html');
      stat = await fs.stat(candidate).catch(() => null);
    }
    if (!stat?.isFile()) {
      if (path.extname(pathname)) return false;
      candidate = path.join(root, 'index.html');
      stat = await fs.stat(candidate).catch(() => null);
    }
    const real = await fs.realpath(candidate).catch(() => null);
    if (!stat?.isFile() || !real?.startsWith(root + path.sep)) return false;
    res.writeHead(200, { ...HEADERS, 'content-type': MIME[path.extname(real)] || 'application/octet-stream', 'content-length': stat.size });
    if (req.method === 'HEAD') res.end();
    else {
      const stream = createReadStream(real);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    }
    return true;
  }
  function proxyOptions(req, target) {
    const headers = { ...req.headers, host: upstream.host };
    delete headers.authorization;
    delete headers.cookie;
    return { hostname: upstream.hostname.replace(/^\[|\]$/g, ''), port: upstream.port, path: target, method: req.method, headers };
  }
  function proxy(req, res, target) {
    const request = http.request(proxyOptions(req, target), (response) => {
      const headers = { ...response.headers, ...HEADERS };
      delete headers['set-cookie'];
      res.writeHead(response.statusCode || 502, headers);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    request.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Editor unavailable.' }); else res.destroy(); });
    req.on('aborted', () => request.destroy());
    res.on('close', () => request.destroy());
    req.pipe(request);
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (!hostAllowed(req)) return json(res, 404, { error: 'Not found' });
      let route;
      try { route = normalizedRequest(req); } catch { return json(res, 400, { error: 'Invalid path.' }); }
      const { pathname, target } = route;
      if (pathname.startsWith('/__open-in-editor')) return json(res, 404, { error: 'Not found' });
      if (mutating(req) && !sameOrigin(req)) return json(res, 403, { error: 'Forbidden' });
      const signedIn = authenticated(req);
      if (pathname === '/api/remote-editor/session' && req.method === 'GET') return json(res, 200, { authenticated: signedIn });
      if (pathname === '/api/remote-editor/login' && req.method === 'POST') return await login(req, res);
      if (pathname === '/api/remote-editor/logout' && req.method === 'POST') return json(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict` });
      if (pathname.startsWith('/api/remote-editor/')) return json(res, 404, { error: 'Not found' });
      if (signedIn) {
        if (mutating(req) && WRITE_BLOCKS.some((prefix) => pathname.startsWith(prefix))) return json(res, 403, { error: 'Publishing is disabled.' });
        return proxy(req, res, target);
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) return json(res, 401, { error: 'Session expired' });
      if (!(await serveStatic(req, res, pathname))) json(res, 404, { error: 'Not found' });
    } catch { if (!res.headersSent) json(res, 500, { error: 'Request failed.' }); else res.destroy(); }
  });
  server.on('upgrade', (req, socket, head) => {
    const deny = (status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n`);
    if (!hostAllowed(req) || !sameOrigin(req) || !authenticated(req)) return deny('401 Unauthorized');
    let route;
    try { route = normalizedRequest(req); } catch { return deny('400 Bad Request'); }
    if (route.pathname.startsWith('/api/') || route.pathname.startsWith('/__open-in-editor')) return deny('403 Forbidden');
    const request = http.request(proxyOptions(req, route.target));
    request.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      upgradedSockets.add(socket);
      upgradedSockets.add(upstreamSocket);
      const cleanup = () => {
        upgradedSockets.delete(socket);
        upgradedSockets.delete(upstreamSocket);
        socket.destroy();
        upstreamSocket.destroy();
      };
      socket.on('close', cleanup);
      upstreamSocket.on('close', cleanup);
      socket.on('error', cleanup);
      upstreamSocket.on('error', cleanup);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    request.on('response', (response) => { response.resume(); deny('502 Bad Gateway'); });
    request.on('error', () => socket.destroy());
    socket.on('close', () => request.destroy());
    request.end();
  });
  return {
    server,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); }),
    close: () => new Promise((resolve, reject) => { for (const socket of upgradedSockets) socket.destroy(); server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections(); }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const gateway = createRemoteEditorServer({ host: process.env.VCD_EDITOR_HOST, port: process.env.VCD_EDITOR_PORT, publicHost: process.env.VCD_EDITOR_PUBLIC_HOST, staticDir: process.env.VCD_EDITOR_STATIC_DIR, upstream: process.env.VCD_EDITOR_UPSTREAM, passwordHash: process.env.VCD_EDITOR_PASSWORD_HASH, sessionSecret: process.env.VCD_EDITOR_SESSION_SECRET });
  await gateway.listen();
}
