import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function devTabState(root = process.cwd()) {
  const hash = createHash('sha256');
  const visit = (relative) => {
    const target = path.join(root, relative);
    if (!existsSync(target)) return;
    const entries = readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) hash.update(file).update(readFileSync(path.join(root, file)));
    }
  };
  // Whole-content matching is conservative; document-scoped snapshots can relax unrelated conflicts later.
  visit('src/content');
  for (const file of ['src/styles/global.css', 'tokens/design-tokens.json']) {
    if (existsSync(path.join(root, file))) hash.update(file).update(readFileSync(path.join(root, file)));
  }
  return { generation: process.env.VCD_TAB_GENERATION ||= randomUUID(), fingerprint: hash.digest('hex') };
}

export function protectStaleTabWrites(req, res, next) {
  const url = String(req.url || '').split('?')[0];
  if (url === '/api/dev-tab-state' && req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(devTabState()));
    return;
  }
  if (!url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    || url === '/api/dev-session-state' || url === '/api/dev-branch-update') return next();
  const generation = req.headers['x-vcd-tab-generation'];
  const state = devTabState();
  if (generation && generation !== state.generation && req.headers['x-vcd-tab-fingerprint'] !== state.fingerprint) {
    res.statusCode = 409;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'This tab has older content. Your draft is still here; copy your changes before reloading.' }));
    return;
  }
  const end = res.end;
  res.end = function (...args) {
    if (!res.headersSent) res.setHeader('x-vcd-tab-fingerprint', devTabState().fingerprint);
    return end.apply(this, args);
  };
  next();
}
