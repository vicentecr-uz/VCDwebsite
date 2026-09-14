import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/DevModeController.astro', import.meta.url), 'utf8');
const leaseSource = source.slice(source.indexOf('const leaseKey ='), source.indexOf('const sendAuthoring ='));
const createLease = new Function('window', 'crypto', `${new Bun.Transpiler({ loader: 'ts' }).transformSync(leaseSource)}; return lease;`);

test('Edit mode creates and reuses its authoring lease on HTTP LAN origins', () => {
  const window = {};
  const lanCrypto = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const lease = createLease(window, lanCrypto);
  expect(lease.id).toMatch(/^dev-[0-9a-f]{32}$/);
  expect(lease.active).toBe(false);
  expect(createLease(window, lanCrypto)).toBe(lease);
  expect(createLease({}, lanCrypto).id).not.toBe(lease.id);
});

test('secure origins retain native UUID authoring lease IDs', () => {
  const lease = createLease({}, { randomUUID: () => 'native-uuid' });
  expect(lease.id).toBe('dev-native-uuid');
});
