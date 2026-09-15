import path from 'node:path';
import { writeAtomicJson } from './dev-api-plugins.mjs';

export const CAROUSEL_DRAG_TUNING_PATH = path.resolve('src/lib/carouselDragTuning.json');
const KEYS = ['tension', 'dragThreshold', 'springBackMs'];
const BOUNDS = { tension: [1, 80], dragThreshold: [0, 40], springBackMs: [80, 600] };

export function validateCarouselDragTuning(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== KEYS.length
    || !KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error('Invalid carousel drag tuning.');
  }
  for (const key of KEYS) {
    const number = value[key];
    const [min, max] = BOUNDS[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) {
      throw new Error('Invalid carousel drag tuning.');
    }
  }
  return Object.fromEntries(KEYS.map((key) => [key, value[key]]));
}

const send = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
};

export function createCarouselDragTuningHandler({ write = writeAtomicJson, configPath = CAROUSEL_DRAG_TUNING_PATH } = {}) {
  return async (req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) { send(res, 415, { error: 'JSON is required.' }); return; }
    const origin = req.headers?.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) { send(res, 403, { error: 'Cross-origin requests are not allowed.' }); return; }
      } catch { send(res, 403, { error: 'Cross-origin requests are not allowed.' }); return; }
    }
    if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
      send(res, 403, { error: 'Cross-origin requests are not allowed.' }); return;
    }
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 10_000) throw new Error('Request too large.');
      }
      const values = validateCarouselDragTuning(JSON.parse(body));
      await write(configPath, values);
      send(res, 200, { path: 'src/lib/carouselDragTuning.json' });
    } catch (error) {
      send(res, error?.message === 'Invalid carousel drag tuning.' || error?.message === 'Request too large.' ? 400 : 500,
        { error: error?.message === 'Invalid carousel drag tuning.' ? error.message : 'Could not write carousel drag tuning.' });
    }
  };
}

export function carouselDragTuningWriter() {
  return {
    name: 'carousel-drag-tuning-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/carousel-drag-tuning', createCarouselDragTuningHandler());
    },
  };
}
