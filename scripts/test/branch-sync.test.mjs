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
  git(root, 'init', '--bare', '--initial-branch=main', bare);
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
  copyFileSync(path.resolve(import.meta.dirname, '../branch-sync-drafts.mjs'), path.join(scripts, 'branch-sync-drafts.mjs'));
  writeFileSync(path.join(work, '.git/info/exclude'), 'scripts/\n.dev-session/\n');
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

async function runOnce(fixture, { astro = 'off', stateUrl, bunBinary = bun } = {}) {
  const proc = Bun.spawn([fixture.script, 'once'], {
    cwd: fixture.work,
    env: { ...process.env, ASTRO_RUNNING: astro, BRANCH_SYNC_BUN: bunBinary, BRANCH_SYNC_DAEMON: '0', BRANCH_SYNC_SESSION_SCRIPT: fixture.session, BRANCH_SYNC_SESSION_LOG: fixture.log, BRANCH_SYNC_REPO: fixture.work, ...(stateUrl ? { BRANCH_SYNC_STATE_URL: stateUrl } : {}) },
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

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(50);
  }
  throw new Error(message);
}

await scenario('1. content update while editing defers without stop/start', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'src/content/project.json');
    await withStateServer({ editing: true, clients: 1 }, async (stateUrl) => assert.equal((await runOnce(fixture, { astro: 'on', stateUrl })).code, 0));
    assert.equal(git(fixture.work, 'rev-parse', 'HEAD'), fixture.oldHead);
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

await scenario('7. manual request wakes the daemon before its interval', async () => {
  const fixture = makeFixture();
  const sessionDir = path.join(fixture.work, '.dev-session');
  mkdirSync(sessionDir);
  const daemon = Bun.spawn([fixture.script, '_daemon'], {
    cwd: fixture.work,
    env: {
      ...process.env,
      ASTRO_RUNNING: 'off',
      BRANCH_SYNC_BUN: bun,
      BRANCH_SYNC_INTERVAL: '60',
      BRANCH_SYNC_SESSION_SCRIPT: fixture.session,
      BRANCH_SYNC_SESSION_LOG: fixture.log,
      BRANCH_SYNC_REPO: fixture.work,
    },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
  try {
    const syncLog = path.join(sessionDir, 'branch-sync.log');
    await waitFor(
      () => existsSync(syncLog) && readFileSync(syncLog, 'utf8').includes('main up to date'),
      'daemon did not reach its wait interval',
    );
    addIncoming(fixture, 'src/content/requested.json');
    writeFileSync(path.join(sessionDir, 'branch-sync.request'), 'now\n');
    await waitFor(
      () => git(fixture.work, 'rev-parse', 'HEAD') !== fixture.oldHead,
      'manual request did not wake the daemon',
    );
    assert.match(readFileSync(syncLog, 'utf8'), /manual sync requested/);
  } finally {
    daemon.kill();
    fixture.close();
  }
});

function snapshotDrafts(fixture) {
  return {
    head: git(fixture.work, 'rev-parse', 'HEAD'),
    status: git(fixture.work, 'status', '--porcelain'),
    staged: git(fixture.work, 'diff', '--cached', '--binary'),
    unstaged: git(fixture.work, 'diff', '--binary'),
    untracked: git(fixture.work, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
      .map((file) => [file, readFileSync(path.join(fixture.work, file)).toString('base64')]),
  };
}

function queueRequest(fixture, id) {
  mkdirSync(path.join(fixture.work, '.dev-session'), { recursive: true });
  writeFileSync(path.join(fixture.work, '.dev-session/branch-sync.request'), JSON.stringify({ id }));
}

await scenario('8. dirty tracked and new binary files survive an update without local commits', async () => {
  const fixture = makeFixture();
  try {
    writeFileSync(path.join(fixture.work, 'README.md'), 'draft\n');
    writeFileSync(path.join(fixture.work, 'new image.bin'), Buffer.from([0, 255, 128, 10]));
    const before = snapshotDrafts(fixture);
    addIncoming(fixture, 'remote.txt');
    assert.equal((await runOnce(fixture)).code, 0);
    const after = snapshotDrafts(fixture);
    assert.notEqual(after.head, before.head);
    assert.deepEqual({ ...after, head: before.head }, before);
    assert.equal(git(fixture.work, 'stash', 'list'), '');
  } finally { fixture.close(); }
});

await scenario('9. local commits plus staged and unstaged drafts survive the rebase', async () => {
  const fixture = makeFixture();
  try {
    writeFileSync(path.join(fixture.work, 'local.txt'), 'local commit\n');
    git(fixture.work, 'add', 'local.txt'); git(fixture.work, 'commit', '-m', 'local content');
    writeFileSync(path.join(fixture.work, 'README.md'), 'staged\n');
    git(fixture.work, 'add', 'README.md');
    writeFileSync(path.join(fixture.work, 'README.md'), 'staged and unstaged\n');
    const before = snapshotDrafts(fixture);
    addIncoming(fixture, 'remote.txt');
    assert.equal((await runOnce(fixture)).code, 0);
    assert.deepEqual({ ...snapshotDrafts(fixture), head: before.head }, before);
    assert.equal(git(fixture.work, 'rev-list', '--count', 'origin/main..HEAD'), '1');
    assert.equal(readFileSync(path.join(fixture.work, 'local.txt'), 'utf8'), 'local commit\n');
  } finally { fixture.close(); }
});

for (const conflict of ['rebase', 'stash', 'untracked']) {
  await scenario(`10. ${conflict} conflict restores the exact prior revision, index, drafts and new files`, async () => {
    const fixture = makeFixture();
    try {
      if (conflict === 'rebase') {
        writeFileSync(path.join(fixture.work, 'README.md'), 'local committed version\n');
        git(fixture.work, 'add', 'README.md'); git(fixture.work, 'commit', '-m', 'local content');
      }
      writeFileSync(path.join(fixture.work, 'README.md'), 'local unsaved version\n');
      if (conflict === 'rebase') git(fixture.work, 'add', 'README.md');
      writeFileSync(path.join(fixture.work, 'new.txt'), 'new draft\n');
      const before = snapshotDrafts(fixture);
      addIncoming(fixture, conflict === 'untracked' ? 'new.txt' : 'README.md', 'remote version\n');
      queueRequest(fixture, `conflict-${conflict}`);
      await withStateServer({ editing: false, clients: 0 }, async (stateUrl) => {
        assert.equal((await runOnce(fixture, { astro: 'on', stateUrl })).code, 1);
      });
      assert.deepEqual(snapshotDrafts(fixture), before);
      assert.equal(git(fixture.work, 'stash', 'list'), '');
      const state = JSON.parse(readFileSync(path.join(fixture.work, '.dev-session/branch-sync.status'), 'utf8'));
      assert.equal(state.id, `conflict-${conflict}`);
      assert.equal(state.state, 'failed');
      assert.match(state.message, /previous revision and drafts were restored/);
      assert.equal(sessionLog(fixture).at(-1)[0], 'start-astro');
      assert.equal(existsSync(path.join(fixture.work, '.dev-session/branch-sync.lock')), false);
    } finally { fixture.close(); }
  });
}

await scenario('11. a concurrent sync cannot mutate the checkout or consume its queued request', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'remote.txt');
    queueRequest(fixture, 'locked');
    mkdirSync(path.join(fixture.work, '.dev-session/branch-sync.lock'));
    assert.equal((await runOnce(fixture)).code, 0);
    assert.equal(git(fixture.work, 'rev-parse', 'HEAD'), fixture.oldHead);
    assert.equal(existsSync(path.join(fixture.work, '.dev-session/branch-sync.request')), true);
  } finally { fixture.close(); }
});

await scenario('12. request succeeds only after the server is restarted and ready', async () => {
  const fixture = makeFixture();
  try {
    addIncoming(fixture, 'remote.txt');
    queueRequest(fixture, 'ready');
    await withStateServer({ editing: false, clients: 0 }, async (stateUrl) => {
      assert.equal((await runOnce(fixture, { astro: 'on', stateUrl })).code, 0);
    });
    const state = JSON.parse(readFileSync(path.join(fixture.work, '.dev-session/branch-sync.status'), 'utf8'));
    assert.equal(state.id, 'ready'); assert.equal(state.state, 'succeeded');
    assert.equal(sessionLog(fixture).at(-1)[0], 'start-astro');
  } finally { fixture.close(); }
});

await scenario('13. dependency failure reports failure after restoring drafts and restarting Astro', async () => {
  const fixture = makeFixture();
  try {
    const wrapper = path.join(fixture.root, 'bun-install-fails.sh');
    writeFileSync(wrapper, '#!/bin/bash\nif [[ "$1" == install ]]; then exit 1; fi\nexec $HOME/.bun/bin/bun "$@"\n');
    chmodSync(wrapper, 0o755);
    writeFileSync(path.join(fixture.work, 'README.md'), 'unpublished draft\n');
    const before = snapshotDrafts(fixture);
    addIncoming(fixture, 'package.json', '{}\n');
    queueRequest(fixture, 'install-failure');
    await withStateServer({ editing: false, clients: 0 }, async (stateUrl) => {
      assert.equal((await runOnce(fixture, { astro: 'on', stateUrl, bunBinary: wrapper })).code, 1);
    });
    assert.deepEqual({ ...snapshotDrafts(fixture), head: before.head }, before);
    const state = JSON.parse(readFileSync(path.join(fixture.work, '.dev-session/branch-sync.status'), 'utf8'));
    assert.equal(state.state, 'failed'); assert.match(state.message, /dependency installation failed/);
    assert.equal(sessionLog(fixture).at(-1)[0], 'start-astro');
  } finally { fixture.close(); }
});

if (failures.length > 0) throw new Error(`${failures.length} branch-sync scenario(s) failed`);
