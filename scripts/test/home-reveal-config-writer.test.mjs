import { describe, expect, test } from 'bun:test';
import { createHeaderMenuDemoConfigHandler, createHomeRevealConfigHandler, validateHomeRevealConfig } from '../home-reveal-config-writer.mjs';
import defaults from '../../src/lib/homeRevealConfig.json';

const valid = structuredClone(defaults);
valid.intro.translateYPx ??= 0;
const request = (body, method = 'POST') => ({ method, async *[Symbol.asyncIterator]() { yield JSON.stringify(body); } });
const response = () => ({ statusCode: 200, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value; } });

describe('home reveal config writer', () => {
  test('returns a normalized clone for valid defaults', () => {
    const result = validateHomeRevealConfig(valid);
    expect(result).toEqual(valid);
    expect(result).not.toBe(valid);
  });
  test('rejects unknown and missing keys', () => {
    expect(() => validateHomeRevealConfig({ ...valid, extra: true })).toThrow();
    const missing = structuredClone(valid); delete missing.entrance.easing;
    expect(() => validateHomeRevealConfig(missing)).toThrow();
  });
  test('rejects bounds, nonfinite values, and header lead beyond stagger', () => {
    for (const value of [NaN, Infinity, 1301]) { const config = structuredClone(valid); config.entrance.durationMs = value; expect(() => validateHomeRevealConfig(config)).toThrow(); }
    const config = structuredClone(valid); config.entrance.headerLeadMs = config.entrance.totalStaggerMs + 1;
    expect(() => validateHomeRevealConfig(config)).toThrow();
    for (const value of [NaN, Infinity, -1, 81]) { const intro = structuredClone(valid); intro.intro.translateYPx = value; expect(() => validateHomeRevealConfig(intro)).toThrow(); }
  });
  test('accepts named and balanced functional easing', () => {
    for (const easing of ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear(0, 1)', 'cubic-bezier(0.2, 0.8, 0.2, 1)']) {
      const config = structuredClone(valid); config.entrance.easing = easing; expect(validateHomeRevealConfig(config).entrance.easing).toBe(easing);
    }
  });
  test('rejects easing lookalikes and trailing content', () => {
    for (const easing of ['easeevil', 'linear(0, 1)\n', 'linear(0, (1))', 'cubic-bezier(0, 1)junk']) {
      const config = structuredClone(valid); config.entrance.easing = easing; expect(() => validateHomeRevealConfig(config)).toThrow();
    }
  });
  test('handler validates and writes through an injected seam', async () => {
    const writes = [];
    const handler = createHomeRevealConfigHandler({ configPath: '/fixed/path', write: async (path, value) => writes.push({ path, value }) });
    const res = response(); await handler(request(valid), res, () => {});
    expect(res.statusCode).toBe(200); expect(res.headers['content-type']).toBe('application/json'); expect(writes[0].path).toBe('/fixed/path');
    const bad = response(); await handler(request({}), bad, () => {}); expect(bad.statusCode).toBe(400); expect(writes).toHaveLength(1);
  });
});

describe('header menu demo config writer', () => {
  test('merges only the tuned cursor offset into the stored config', async () => {
    const writes = [];
    const stored = { radius: 70, cursorOffset: 75 };
    const handler = createHeaderMenuDemoConfigHandler({ configPath: '/fixed/demo', read: async () => JSON.stringify(stored), write: async (path, value) => writes.push({ path, value }) });
    const res = response(); await handler(request({ cursorOffset: -200 }), res, () => {});
    expect(res.statusCode).toBe(200); expect(writes).toEqual([{ path: '/fixed/demo', value: { radius: 70, cursorOffset: -200 } }]);
    for (const body of [{}, { cursorOffset: 801 }, { cursorOffset: NaN }, { cursorOffset: 0, radius: 1 }]) {
      const bad = response(); await handler(request(body), bad, () => {}); expect(bad.statusCode).toBe(400);
    }
    expect(writes).toHaveLength(1);
  });
});
