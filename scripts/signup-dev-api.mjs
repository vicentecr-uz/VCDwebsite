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

const mountApi = (server, route, tooLarge, handle) => {
  server.middlewares.use(route, async (req, res, next) => {
    try {
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
            send(res, 400, { error: tooLarge });
            return;
          }
          chunks.push(buf);
        }
        init.body = Buffer.concat(chunks);
      }

      const request = new Request(url, init);
      const response = await handle(request, env);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'transfer-encoding') return;
        res.setHeader(key, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  });
};

/**
 * Vite plugin (`apply: 'serve'`) — local /api/signup and /api/signup-pref.
 */
export function signupDevApi() {
  return {
    name: 'signup-dev-api',
    apply: 'serve',
    configureServer(server) {
      mountApi(server, '/api/signup', 'Enter a valid email address.', async (request, env) => {
        const { handleSignupRequest } = await server.ssrLoadModule('/src/lib/signup-handler.ts');
        return handleSignupRequest(request, env, { isDev: true });
      });
      mountApi(server, '/api/signup-pref', 'That note is too long.', async (request, env) => {
        const { mkdir, readFile, appendFile } = await import('node:fs/promises');
        const { handleSignupPrefRequest } = await server.ssrLoadModule('/src/lib/signup-pref-handler.ts');
        const file = path.join(server.config.root || process.cwd(), '.data/signup-pref.jsonl');
        const store = {
          add: async (vote) => {
            await mkdir(path.dirname(file), { recursive: true });
            await appendFile(file, `${JSON.stringify(vote)}\n`);
          },
          list: async () => {
            if (!existsSync(file)) return [];
            const raw = await readFile(file, 'utf8');
            return raw.split('\n').flatMap((line) => {
              const trimmed = line.trim();
              if (!trimmed) return [];
              try {
                return [JSON.parse(trimmed)];
              } catch {
                return [];
              }
            });
          },
        };
        return handleSignupPrefRequest(request, store, {
          isDev: true,
          resultsKey: env.SIGNUP_PREF_KEY,
        });
      });
    },
  };
}
