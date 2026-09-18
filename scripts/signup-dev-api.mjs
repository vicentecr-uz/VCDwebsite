import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Load listmonk secrets for local astro-dev.
 * process.env wins; `.dev.vars` fills gaps (never commit that file).
 */
export function loadSignupDevEnv(root = process.cwd()) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env };
  const file = path.join(root, '.dev.vars');
  if (!existsSync(file)) return env;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!env[key]) env[key] = value;
  }
  return env;
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

/**
 * Vite plugin (`apply: 'serve'`) — mounts POST /api/signup for local astro-dev.
 * Shares `handleSignupRequest` with the Pages Function via ssrLoadModule.
 */
export function signupDevApi() {
  return {
    name: 'signup-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/signup', async (req, res, next) => {
        try {
          const { handleSignupRequest } = await server.ssrLoadModule('/src/lib/signup-handler.ts');
          const env = loadSignupDevEnv(server.config.root || process.cwd());

          const host = req.headers.host || 'localhost';
          const url = new URL(req.url || '/', `http://${host}`);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value == null) continue;
            headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
          }

          /** @type {RequestInit} */
          const init = { method: req.method || 'GET', headers };
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              size += buf.length;
              if (size > 8192) {
                send(res, 400, { error: 'Enter a valid email address.' });
                return;
              }
              chunks.push(buf);
            }
            init.body = Buffer.concat(chunks);
          }

          const request = new Request(url, init);
          const response = await handleSignupRequest(request, env, { isDev: true });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'transfer-encoding') return;
            res.setHeader(key, value);
          });
          const buf = Buffer.from(await response.arrayBuffer());
          res.end(buf);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
