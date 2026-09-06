import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const productionScript = path.resolve(import.meta.dirname, '../branch-sync.sh');
const bun = '$HOME/.bun/bin/bun';
const failures = [];

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'vcd-branch-sync-'));
  const bare = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const work = path.join(root, 'work');
  const peer = path.join(root, 'peer');
  git(root, 'init', '--bare', bare);
  mkdirSync(seed);
  git(seed, 'init', '-b', 'main');
  git(seed, 'config', 'user.email', 'test@example.com');
  git(seed, 'config', 'user.name', 'Branch Sync Test');
  writeFileSync(path.join(seed, 'README.md'), 'initial\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'initial');
  git(seed, 'remote', 'add', 'origin', bare);
  git(seed, 'push', '-u', 'origin', 'main');
  git(root, 'clone', bare, work);
  git(root, 'clone', bare, peer);
  for (const repo of [work, peer]) {
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Branch Sync Test');
  }
  const scripts = path.join(work, 'scripts');
  mkdirSync(scripts);
  const script = path.join(scripts, 'branch-sync.sh');
  copyFileSync(productionScript, script);
  chmodSync(script, 0o755);
  const log = path.join(root, 'session.log');
  const session = path.join(scripts, 'fake-session.sh');
  writeFileSync(session, `#!/usr/bin/env bash
set -euo pipefail
action="$1"
head="$(git -C "$BRANCH_SYNC_REPO" rev-parse HEAD)"
printf '%s|%s\\n' "$action" "$head" >> "$BRANCH_SYNC_SESSION_LOG"
case "$action" in
  astro-running) [[ "\${ASTRO_RUNNING:-off}" == "on" ]] ;;
  stop-astro|start-astro) exit 0 ;;
  *) exit 2 ;;
esac
`);
  chmodSync(session, 0o755);
  return { root, work, peer, script, session, log, oldHead: git(work, 'rev-parse', 'HEAD'), close: () => rmSync(root, { recursive: true, force: true }) };
}

function addIncoming(fixture, file, contents = 'incoming\n') {
  const target = path.join(fixture.peer, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  git(fixture.peer, 'add', file);
  git(fixture.peer, 'commit', '-m', `incoming ${file}`);
  git(fixture.peer, 'push', 'origin', 'main');
}

function sessionLog(fixture) {
  return existsSync(fixture.log) ? readFileSync(fixture.log, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('|')) : [];
}

async function runOnce(fixture, { astro = 'off', stateUrl } = {}) {
  const proc = Bun.spawn([fixture.script, 'once'], {
    cwd: fixture.work,
    env: { ...process.env, ASTRO_RUNNING: astro, BRANCH_SYNC_BUN: bun, BRANCH_SYNC_DAEMON: '0', BRANCH_SYNC_SESSION_SCRIPT: fixture.session, BRANCH_SYNC_SESSION_LOG: fixture.log, BRANCH_SYNC_REPO: fixture.work, ...(stateUrl ? { BRANCH_SYNC_STATE_URL: stateUrl } : {}) },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;
  let timeout;
  try {
    const [code, stdout, stderr] = await Promise.all([
      Promise.race([
        proc.exited,
        new Promise((resolve) => { timeout = setTimeout(() => {
          timedOut = true;
          proc.kill();
          resolve(null);
        }, 10_000); }),
      ]),
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    assert.equal(timedOut, false, `branch-sync timed out: ${stdout}${stderr}`);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    if (timedOut) proc.kill();
  }
}

async function withStateServer(state, fn) {
  const server = Bun.serve({ port: 0, fetch: () => Response.json(state) });
  try {
    return await fn(`http://127.0.0.1:${server.port}/state`);
  } finally {
    server.stop(true);
  }
}

async function scenario(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL: ${name}\n${error.stack || error}`);
  }
}

await scenario('1. content update while editing advances HEAD without stop/start', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'src/content/project.json');
    await withStateServer({ editing: true, clients: 1 }, async (stateUrl) => assert.equal((await runOnce(fixture, { astro: 'on', stateUrl })).code, 0));
    assert.notEqual(git(fixture.work, 'rev-parse', 'HEAD'), fixture.oldHead);
    assert.deepEqual(sessionLog(fixture).map(([action]) => action).filter((action) => action !== 'astro-running'), []);
  } finally { fixture.close(); }
});

await scenario('2. runtime update while editing defers without stop/start', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'src/components/Widget.astro');
    await withStateServer({ editing: true, clients: 1 }, async (stateUrl) => assert.equal((await runOnce(fixture, { astro: 'on', stateUrl })).code, 0));
    assert.equal(git(fixture.work, 'rev-parse', 'HEAD'), fixture.oldHead);
    assert.deepEqual(sessionLog(fixture).map(([action]) => action), ['astro-running']);
  } finally { fixture.close(); }
});

await scenario('3. idle runtime update stops before pull and starts after pull', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'src/components/Widget.astro');
    await withStateServer({ editing: false, clients: 0 }, async (stateUrl) => assert.equal((await runOnce(fixture, { astro: 'on', stateUrl })).code, 0));
    const newHead = git(fixture.work, 'rev-parse', 'HEAD');
    assert.notEqual(newHead, fixture.oldHead);
    assert.deepEqual(sessionLog(fixture).map(([action]) => action), ['astro-running', 'stop-astro', 'start-astro']);
    const log = sessionLog(fixture);
    assert.equal(log[1][1], fixture.oldHead, 'stop must observe old HEAD');
    assert.equal(log[2][1], newHead, 'start must observe new HEAD');
  } finally { fixture.close(); }
});

await scenario('4. unreachable state URL defers runtime update without lifecycle calls', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'src/components/Widget.astro');
    const result = await runOnce(fixture, { astro: 'on', stateUrl: 'http://127.0.0.1:1/unavailable' });
    assert.equal(result.code, 0);
    assert.equal(git(fixture.work, 'rev-parse', 'HEAD'), fixture.oldHead);
    assert.deepEqual(sessionLog(fixture).map(([action]) => action), ['astro-running']);
  } finally { fixture.close(); }
});

await scenario('5. runtime update with Astro off advances HEAD without lifecycle calls', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'src/components/Widget.astro');
    const result = await runOnce(fixture, { astro: 'off', stateUrl: 'http://127.0.0.1:1/unavailable' });
    assert.equal(result.code, 0);
    assert.notEqual(git(fixture.work, 'rev-parse', 'HEAD'), fixture.oldHead);
    assert.deepEqual(sessionLog(fixture).map(([action]) => action), ['astro-running']);
  } finally { fixture.close(); }
});

await scenario('6. safe update without script change exits cleanly', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'src/content/project.json');
    const result = await runOnce(fixture, { astro: 'off' });
    assert.equal(result.code, 0);
    assert.notEqual(git(fixture.work, 'rev-parse', 'HEAD'), fixture.oldHead);
  } finally { fixture.close(); }
});

if (failures.length > 0) throw new Error(`${failures.length} branch-sync scenario(s) failed`);
