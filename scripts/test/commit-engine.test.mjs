import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'vcd-commit-engine-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
const helper = join(root, 'commit-engine.sh');
await cp(new URL('../commit-engine.sh', import.meta.url), helper);
const run = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const helperRun = (args, cwd = root) => execFileSync('bash', [helper, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

run(['init', '-q']);
run(['config', 'user.name', 'Test']);
run(['config', 'user.email', 'test@example.com']);
await writeFile(join(root, 'engine.txt'), 'one\n');
run(['add', 'engine.txt']);
run(['commit', '-qm', 'initial']);
const initialHead = run(['rev-parse', 'HEAD']);

assert.throws(() => helperRun(['message']), /Explicit paths are required/);
assert.throws(() => helperRun(['--schema-migration', 'message', 'engine.txt']), /schema migrations/);

await writeFile(join(root, 'engine.txt'), 'two\n');
await writeFile(join(root, 'other.txt'), 'unrelated\n');
run(['add', 'other.txt']);
const stagedBeforeRefusal = run(['diff', '--cached', '--binary']);
assert.throws(() => helperRun(['message', 'engine.txt']), /index already contains staged changes/);
assert.equal(run(['diff', '--cached', '--binary']), stagedBeforeRefusal);
assert.equal(run(['rev-parse', 'HEAD']), initialHead);
run(['reset', '-q']);

await mkdir(join(root, 'src/content'), { recursive: true });
await writeFile(join(root, 'src/content/private.json'), '{}\n');
assert.throws(() => helperRun(['message', 'src/content/private.json']), /private content/);
run(['add', '-f', 'src/content/private.json']);
const privateStagedBeforeRefusal = run(['diff', '--cached', '--binary']);
assert.throws(() => helperRun(['message', 'engine.txt']), /index already contains staged changes/);
assert.equal(run(['diff', '--cached', '--binary']), privateStagedBeforeRefusal);
run(['reset', '-q']);

await writeFile(join(root, 'src/content/private\nname.json'), '{}\n');
assert.throws(() => helperRun(['message', 'src']), /private paths entered the staged diff/);
assert.equal(run(['rev-parse', 'HEAD']), initialHead);
assert.ok(run(['diff', '--cached', '--name-only', '-z']).includes('src/content/private\nname.json\0'));
run(['reset', '-q']);

for (const path of ['.content.git/config', '.claude/settings.json', '.codex/config.toml', '.env', '.env.production', '.dev.vars']) {
  assert.throws(() => helperRun(['message', path]), /private content or operations/);
}

helperRun(['message', 'engine.txt']);
assert.equal(run(['log', '-1', '--format=%s']).trim(), 'message');
assert.equal(run(['show', '--format=', '--name-only', 'HEAD']).trim(), 'engine.txt');
assert.ok(run(['status', '--porcelain']).includes('other.txt'));
await writeFile(join(root, '.env.example'), 'PUBLIC_SITE_URL=https://example.com\n');
helperRun(['document environment', '.env.example']);
assert.equal(run(['show', '--format=', '--name-only', 'HEAD']).trim(), '.env.example');
console.log('commit-engine helper tests passed');
