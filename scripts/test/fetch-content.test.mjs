import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const script = path.join(root, 'scripts/fetch-content.sh');
const sample = path.join(root, 'sample-content');
const fixtures = [];
test.after(async () => { await Promise.all(fixtures.map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'vcd-fetch-'));
  fixtures.push(dir);
  await run('git', ['init', '-q'], { cwd: dir });
  await mkdir(path.join(dir, 'scripts'), { recursive: true });
  await cp(script, path.join(dir, 'scripts/fetch-content.sh'));
  await cp(sample, path.join(dir, 'sample-content'), { recursive: true });
  return dir;
}

test('sample source refuses replacement unless explicitly enabled', async () => {
  const dir = await fixture();
  await mkdir(path.join(dir, 'src/content'), { recursive: true });
  await writeFile(path.join(dir, 'src/content/sentinel'), 'keep');
  await assert.rejects(run('bash', [path.join(dir, 'scripts/fetch-content.sh')], { cwd: dir, env: { ...process.env, CONTENT_SOURCE: 'sample' } }));
  assert.equal(await readFile(path.join(dir, 'src/content/sentinel'), 'utf8'), 'keep');
});

test('sample source stages the bundled tree with --replace', async () => {
  const dir = await fixture();
  await mkdir(path.join(dir, 'src/content'), { recursive: true });
  await writeFile(path.join(dir, 'src/content/sentinel'), 'remove');
  await run('bash', [path.join(dir, 'scripts/fetch-content.sh'), '--replace'], { cwd: dir, env: { ...process.env, CONTENT_SOURCE: 'sample' } });
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'src/content/settings/schema.json'), 'utf8')), { schemaVersion: 1 });
  await assert.rejects(readFile(path.join(dir, 'src/content/sentinel')));
});

test('invalid sample source fails before changing destination', async () => {
  const dir = await fixture();
  await writeFile(path.join(dir, 'sample-content/src/content/settings/schema.json'), '{"schemaVersion":2}');
  await assert.rejects(run('bash', [path.join(dir, 'scripts/fetch-content.sh'), '--replace'], { cwd: dir, env: { ...process.env, CONTENT_SOURCE: 'sample' } }));
  assert.equal(await readFile(path.join(dir, 'sample-content/src/content/settings/schema.json'), 'utf8'), '{"schemaVersion":2}');
});

test('local content repository source succeeds', async () => {
  const dir = await fixture();
  const repo = path.join(dir, 'content-repo');
  await cp(sample, repo, { recursive: true });
  await run('git', ['init', '-q', repo]);
  await run('git', ['-C', repo, 'add', '.']);
  await run('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'content']);
  await run('bash', [path.join(dir, 'scripts/fetch-content.sh'), '--replace'], { cwd: dir, env: { ...process.env, CONTENT_REPO: repo, CONTENT_SOURCE: 'repo' } });
  assert.match(await readFile(path.join(dir, 'src/content/settings/header.json'), 'utf8'), /Sample Studio/);
});

test('failed repository clone preserves existing destination', async () => {
  const dir = await fixture();
  await mkdir(path.join(dir, 'src/content'), { recursive: true });
  await writeFile(path.join(dir, 'src/content/sentinel'), 'keep');
  await assert.rejects(run('bash', [path.join(dir, 'scripts/fetch-content.sh'), '--replace'], { cwd: dir, env: { ...process.env, CONTENT_REPO: path.join(dir, 'missing'), CONTENT_SOURCE: 'repo' } }));
  assert.equal(await readFile(path.join(dir, 'src/content/sentinel'), 'utf8'), 'keep');
});

test('replacement removes stale optional public roots', async () => {
  const dir = await fixture();
  await mkdir(path.join(dir, 'public/images'), { recursive: true });
  await writeFile(path.join(dir, 'public/images/private'), 'stale');
  await run('bash', [path.join(dir, 'scripts/fetch-content.sh'), '--replace'], { cwd: dir, env: { ...process.env, CONTENT_SOURCE: 'sample' } });
  await assert.rejects(readFile(path.join(dir, 'public/images/private')));
});

test('destination symlink is rejected', async () => {
  const dir = await fixture();
  await symlink(path.join(dir, 'outside'), path.join(dir, 'media'));
  await assert.rejects(run('bash', [path.join(dir, 'scripts/fetch-content.sh'), '--replace'], { cwd: dir, env: { ...process.env, CONTENT_SOURCE: 'sample' } }));
});

test('source symlink and malformed header preserve destination', async () => {
  const dir = await fixture();
  await mkdir(path.join(dir, 'src/content'), { recursive: true });
  await writeFile(path.join(dir, 'src/content/sentinel'), 'keep');
  await symlink(path.join(dir, 'outside'), path.join(dir, 'sample-content/media/escape'));
  await assert.rejects(run('bash', [path.join(dir, 'scripts/fetch-content.sh'), '--replace'], { cwd: dir, env: { ...process.env, CONTENT_SOURCE: 'sample' } }));
  assert.equal(await readFile(path.join(dir, 'src/content/sentinel'), 'utf8'), 'keep');
  await rm(path.join(dir, 'sample-content/media/escape'));
  await writeFile(path.join(dir, 'sample-content/src/content/settings/header.json'), '[]');
  await assert.rejects(run('bash', [path.join(dir, 'scripts/fetch-content.sh'), '--replace'], { cwd: dir, env: { ...process.env, CONTENT_SOURCE: 'sample' } }));
  assert.equal(await readFile(path.join(dir, 'src/content/sentinel'), 'utf8'), 'keep');
});
