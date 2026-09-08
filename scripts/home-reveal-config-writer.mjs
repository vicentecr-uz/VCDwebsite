import path from 'node:path';
import { writeAtomicJson } from './dev-api-plugins.mjs';

export const HOME_REVEAL_CONFIG_PATH = path.resolve('src/lib/homeRevealConfig.json');
const easingPattern = /^(?:linear\([^\n]*\)|cubic-bezier\([^\n]*\)|ease(?:-in|-out|-in-out)?)$/;
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function validateHomeRevealConfig(value) {
  const intro = value?.intro;
  const entrance = value?.entrance;
  if (!value || Object.keys(value).length !== 2 || !intro || !entrance || Object.keys(intro).length !== 3 || Object.keys(entrance).length !== 7) throw new Error('Invalid reveal configuration.');
  if (!number(intro.durationMs, 50, 400) || !number(intro.blurPx, 0, 20) || !number(intro.scale, .8, 1)) throw new Error('Invalid reveal configuration.');
  if (!number(entrance.durationMs, 150, 1200) || !number(entrance.totalStaggerMs, 0, 1500) || !number(entrance.headerLeadMs, 0, Math.min(600, entrance.totalStaggerMs)) || !number(entrance.blurPx, 0, 40) || !number(entrance.translateYPx, -40, 80) || !number(entrance.scale, .8, 1.3) || typeof entrance.easing !== 'string' || entrance.easing.length > 5000 || !easingPattern.test(entrance.easing.trim())) throw new Error('Invalid reveal configuration.');
  return { intro: { ...intro }, entrance: { ...entrance, easing: entrance.easing.trim() } };
}

export function homeRevealConfigWriter() {
  return { name: 'home-reveal-config-writer', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/home-reveal-config', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const config = validateHomeRevealConfig(JSON.parse(body));
        await writeAtomicJson(HOME_REVEAL_CONFIG_PATH, config);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ path: 'src/lib/homeRevealConfig.json' }));
      } catch {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid reveal configuration.' }));
      }
    });
  } };
}
