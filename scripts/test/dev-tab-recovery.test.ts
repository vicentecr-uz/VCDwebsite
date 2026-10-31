import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { installDevTabRecovery } from '../../src/lib/devTabRecovery';
import { contentHmrGate } from '../content-hmr-gate.mjs';
import { devTabState, protectStaleTabWrites } from '../dev-tab-state.mjs';
import { readFileSync } from 'node:fs';

test('server rejects changed content from an older tab before a writer runs', () => {
  const state = devTabState();
  for (const [generation, fingerprint, allowed] of [
    ['older', 'changed', false], ['older', state.fingerprint, true], [state.generation, 'changed', true],
  ]) {
    let called = false; let body = ''; let status = 200;
    const res = { setHeader() {}, end(value) { body = value; }, set statusCode(value) { status = value; } };
    protectStaleTabWrites({ url: '/api/content-section', method: 'POST', headers: { 'x-vcd-tab-generation': generation, 'x-vcd-tab-fingerprint': fingerprint } }, res, () => { called = true; });
    expect(called).toBe(allowed);
    if (!allowed) { expect(status).toBe(409); expect(JSON.parse(body).error).toContain('draft is still here'); }
  }
});

test('Vite reconnect reloads go through tab recovery', () => {
  const source = readFileSync(new URL('../../node_modules/vite/dist/client/client.mjs', import.meta.url), 'utf8');
  const transformed = contentHmrGate().transform(source, '/node_modules/vite/dist/client/client.mjs');
  expect(transformed).not.toContain('location.reload()');
  expect(transformed).toContain('vcd:dev-reconnect');
});

test('focus recovery waits for a visible tab and mutations carry the original generation', async () => {
  const win = new Window({ url: 'http://localhost:4329/' });
  win.document.head.innerHTML = '<meta name="vcd-tab-state" content=\'{"generation":"old","fingerprint":"original"}\'>';
  let focused = false; let recovered = 0; const writes: Request[] = [];
  win.document.hasFocus = () => focused;
  Object.defineProperty(win.document, 'visibilityState', { value: 'visible' });
  win.fetch = async (input) => {
    if (typeof input === 'string') return Response.json({ generation: 'new', fingerprint: 'original' });
    writes.push(input as Request);
    return Response.json({}, { headers: { 'x-vcd-tab-fingerprint': 'saved' } });
  };
  const names = ['window', 'document', 'location', 'setInterval', 'CustomEvent'];
  const old = names.map((name) => globalThis[name]);
  Object.assign(globalThis, { window: win, document: win.document, location: win.location, setInterval: () => 0, CustomEvent: win.CustomEvent });
  try {
    installDevTabRecovery();
    win.addEventListener('vcd:dev-tab-stale', (event: any) => { event.detail.recover = async () => { recovered++; }; });
    win.dispatchEvent(new win.Event('focus'));
    await Bun.sleep(5);
    expect(recovered).toBe(0);
    focused = true;
    win.dispatchEvent(new win.Event('focus'));
    await Bun.sleep(5);
    expect(recovered).toBe(1);
    await win.fetch('http://localhost:4329/api/content-text', { method: 'POST' });
    await win.fetch('http://localhost:4329/api/content-text', { method: 'POST' });
    expect(writes[0].headers.get('x-vcd-tab-generation')).toBe('old');
    expect(writes[0].headers.get('x-vcd-tab-fingerprint')).toBe('original');
    expect(writes[1].headers.get('x-vcd-tab-fingerprint')).toBe('saved');
  } finally {
    names.forEach((name, i) => globalThis[name] = old[i]);
    await win.happyDOM.close();
  }
});
