// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

const TAPICO_CONTENT = 'src/content/projects/tapico.json';
const GLOBAL_STYLES = 'src/styles/global.css';
const EDITABLE_COLOR_TOKENS = new Set([
  '--color-bg',
  '--color-surface-soft',
  '--color-surface-strong',
  '--color-text',
  '--color-text-soft',
  '--color-text-muted',
  '--color-border',
]);

const clampRound = (value, min, max, decimals) => {
  const bounded = Math.min(max, Math.max(min, value));
  const factor = 10 ** decimals;
  return Math.round(bounded * factor) / factor;
};

/**
 * Dev-only writer for the Tapico hero crop. `apply: 'serve'` means this plugin
 * is active only under `astro dev` — it is never part of the static production
 * build, so nothing is emitted to `dist/` and the live site has no such route.
 * The Tapico crop tuner POSTs `{ x, y, zoom }` here; we persist it into the
 * hero section of `tapico.json` so committing that file publishes the crop.
 *
 * @returns {import('vite').Plugin}
 */
function tapicoCropDevWriter() {
  return {
    name: 'tapico-crop-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/tapico-crop', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

          const x = Number(body.x);
          const y = Number(body.y);
          const zoom = Number(body.zoom);
          if (![x, y, zoom].every(Number.isFinite)) {
            send(400, { error: 'x, y and zoom must be finite numbers.' });
            return;
          }

          const crop = {
            x: clampRound(x, -100, 100, 1),
            y: clampRound(y, -100, 100, 1),
            zoom: clampRound(zoom, 1, 1.5, 2),
          };

          const file = path.join(process.cwd(), TAPICO_CONTENT);
          const data = JSON.parse(await readFile(file, 'utf8'));
          const hero = data.sections?.find((section) => section.type === 'heroImage');
          if (!hero) {
            send(500, { error: 'No heroImage section found in tapico.json.' });
            return;
          }

          hero.crop = crop;
          await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
          send(200, { ok: true, crop });
        } catch {
          send(400, { error: 'Could not parse or write the crop.' });
        }
      });
    },
  };
}

/**
 * Dev-only writer for literal colour tokens in global.css.
 *
 * @returns {import('vite').Plugin}
 */
function styleTokenDevWriter() {
  return {
    name: 'style-token-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/style-token', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const token = String(body.token || '');
          const rawValue = String(body.value || '').trim();

          if (!EDITABLE_COLOR_TOKENS.has(token)) {
            send(400, { error: 'That colour token is not editable.' });
            return;
          }

          const shortHex = /^#([0-9a-f]{3})$/i.exec(rawValue);
          const longHex = /^#([0-9a-f]{6})$/i.exec(rawValue);
          if (!shortHex && !longHex) {
            send(400, { error: 'Use a 3- or 6-digit hex colour.' });
            return;
          }

          const value = shortHex
            ? `#${[...shortHex[1]].map((digit) => digit.repeat(2)).join('')}`.toLowerCase()
            : rawValue.toLowerCase();
          const file = path.join(process.cwd(), GLOBAL_STYLES);
          const source = await readFile(file, 'utf8');
          const declaration = new RegExp(`(^\\s*${token}:\\s*)(#[0-9a-fA-F]{3,6})(\\s*;)`, 'm');

          if (!declaration.test(source)) {
            send(500, { error: `Could not find ${token} in global.css.` });
            return;
          }

          await writeFile(file, source.replace(declaration, `$1${value}$3`), 'utf8');
          send(200, { ok: true, token, value });
        } catch {
          send(400, { error: 'Could not parse or write the colour token.' });
        }
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  // TODO: Re-enable Astro dev toolbar after investigating dev-mode layout jump.
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss(), tapicoCropDevWriter(), styleTokenDevWriter()],
    optimizeDeps: {
      include: ['gsap', '@melloware/coloris'],
    },
    server: {
      watch: {
        ignored: ['**/ROADMAP.md', '**/sitemap/**']
      }
    }
  }
});
