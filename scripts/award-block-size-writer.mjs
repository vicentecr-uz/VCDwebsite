import path from 'node:path';
import { writeAtomicJson } from './dev-api-plugins.mjs';

export const AWARD_BLOCK_SIZE_PATH = path.resolve('src/lib/awardBlockSize.json');
const KEYS = ['mobile', 'tablet', 'desktop'];
const MIN_HEIGHT = 32;
const MAX_HEIGHT = 200;

const hasExactKeys = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === KEYS.length
  && KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))
);

export function validateAwardBlockSize(value) {
  if (!hasExactKeys(value) || !KEYS.every((key) => (
    typeof value[key] === 'number'
    && Number.isFinite(value[key])
    && value[key] >= MIN_HEIGHT
    && value[key] <= MAX_HEIGHT
  ))) throw new Error('Invalid award block size configuration.');
  return Object.fromEntries(KEYS.map((key) => [key, value[key]]));
}

const send = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
};

export function createAwardBlockSizeHandler({ write = writeAtomicJson, configPath = AWARD_BLOCK_SIZE_PATH } = {}) {
  return async (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      send(res, 415, { error: 'JSON is required.' });
      return;
    }
    const origin = req.headers?.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          send(res, 403, { error: 'Cross-origin requests are not allowed.' });
          return;
        }
      } catch {
        send(res, 403, { error: 'Cross-origin requests are not allowed.' });
        return;
      }
    }
    if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
      send(res, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    let values;
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 10_000) throw new Error('Request too large.');
      }
      values = validateAwardBlockSize(JSON.parse(body));
    } catch {
      send(res, 400, { error: 'Invalid award block size configuration.' });
      return;
    }
    try {
      await write(configPath, values);
      send(res, 200, { path: 'src/lib/awardBlockSize.json' });
    } catch {
      send(res, 500, { error: 'Could not write award block size configuration.' });
    }
  };
}

export function awardBlockSizeWriter() {
  return {
    name: 'award-block-size-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/award-block-size', createAwardBlockSizeHandler());
    },
  };
}
