import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeAtomicJson } from './dev-api-plugins.mjs';

export const HOME_REVEAL_CONFIG_PATH = path.resolve('src/lib/homeRevealConfig.json');
export const HEADER_MENU_DEMO_CONFIG_PATH = path.resolve('src/lib/headerMenuDemoConfig.json');
const TOP_LEVEL_KEYS = ['intro', 'entrance'];
const INTRO_KEYS = ['durationMs', 'blurPx', 'scale', 'translateYPx'];
const ENTRANCE_KEYS = ['durationMs', 'totalStaggerMs', 'headerLeadMs', 'blurPx', 'translateYPx', 'scale', 'easing'];

const hasExactKeys = (value, keys) => (
  value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
);
const bounded = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function validEasing(value) {
  if (typeof value !== 'string' || value.length > 5000 || value.trim() !== value || value.includes('\n') || value.includes('\r')) return false;
  if (/^ease(?:-in|-out|-in-out)?$/.test(value)) return true;
  const match = /^(linear|cubic-bezier)\((.*)\)$/.exec(value);
  if (!match || !match[2] || /[()]/.test(match[2])) return false;
  return value.indexOf('(') === value.lastIndexOf('(') && value.endsWith(')');
}

export function validateHomeRevealConfig(value) {
  if (!hasExactKeys(value, TOP_LEVEL_KEYS) || !hasExactKeys(value.intro, INTRO_KEYS) || !hasExactKeys(value.entrance, ENTRANCE_KEYS)) throw new Error('Invalid reveal configuration.');
  const { intro, entrance } = value;
  if (!bounded(intro.durationMs, 50, 400) || !bounded(intro.blurPx, 0, 20) || !bounded(intro.scale, 0.8, 1) || !bounded(intro.translateYPx, 0, 80)) throw new Error('Invalid reveal configuration.');
  if (!bounded(entrance.durationMs, 150, 1300) || !bounded(entrance.totalStaggerMs, 0, 1500) || !bounded(entrance.headerLeadMs, 0, 600) || entrance.headerLeadMs > entrance.totalStaggerMs || !bounded(entrance.blurPx, 0, 40) || !bounded(entrance.translateYPx, -40, 80) || !bounded(entrance.scale, 0.8, 1.3) || !validEasing(entrance.easing)) throw new Error('Invalid reveal configuration.');
  return { intro: { ...intro }, entrance: { ...entrance } };
}

const send = (res, status, payload) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); };

export function createHomeRevealConfigHandler({ write = writeAtomicJson, configPath = HOME_REVEAL_CONFIG_PATH } = {}) {
  return async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const config = validateHomeRevealConfig(JSON.parse(body));
      await write(configPath, config);
      send(res, 200, { path: 'src/lib/homeRevealConfig.json' });
    } catch { send(res, 400, { error: 'Invalid reveal configuration.' }); }
  };
}

// Only the tuner's dialled fields are writable; the rest of the demo config stays as approved.
export function validateHeaderMenuDemoTuning(value) {
  if (!hasExactKeys(value, ['cursorOffset']) || !bounded(value.cursorOffset, -800, 800)) throw new Error('Invalid menu demo configuration.');
  return { cursorOffset: value.cursorOffset };
}

export function createHeaderMenuDemoConfigHandler({ write = writeAtomicJson, read = (file) => readFile(file, 'utf8'), configPath = HEADER_MENU_DEMO_CONFIG_PATH } = {}) {
  return async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const tuning = validateHeaderMenuDemoTuning(JSON.parse(body));
      await write(configPath, { ...JSON.parse(await read(configPath)), ...tuning });
      send(res, 200, { path: 'src/lib/headerMenuDemoConfig.json' });
    } catch { send(res, 400, { error: 'Invalid menu demo configuration.' }); }
  };
}

export function homeRevealConfigWriter() {
  return { name: 'home-reveal-config-writer', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/home-reveal-config', createHomeRevealConfigHandler());
    server.middlewares.use('/api/header-menu-demo-config', createHeaderMenuDemoConfigHandler());
  } };
}
