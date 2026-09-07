import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { branchUpdateState, requestBranchUpdate } from '../dev-branch-update.mjs';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

const root = mkdtempSync(path.join(tmpdir(), 'vcd-dev-branch-update-'));
const bare = path.join(root, 'origin.git');
const work = path.join(root, 'work');
const peer = path.join(root, 'peer');

try {
  git(root, 'init', '--bare', '--initial-branch=main', bare);
  mkdirSync(work);
  git(work, 'init', '-b', 'main');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Branch Update Test');
  writeFileSync(path.join(work, 'README.md'), 'initial\n');
  git(work, 'add', '.');
  git(work, 'commit', '-m', 'initial');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-u', 'origin', 'main');
  git(root, 'clone', bare, peer);
  git(peer, 'config', 'user.email', 'test@example.com');
  git(peer, 'config', 'user.name', 'Branch Update Test');

  assert.deepEqual(await branchUpdateState(work), {
    branch: 'main', revision: git(work, 'rev-parse', 'HEAD'), mainRevision: git(work, 'rev-parse', 'origin/main'),
    behind: 0, ahead: 0, clean: true, available: false,
  });

  writeFileSync(path.join(peer, 'remote.txt'), 'incoming\n');
  git(peer, 'add', 'remote.txt');
  git(peer, 'commit', '-m', 'incoming');
  git(peer, 'push', 'origin', 'main');
  git(work, 'fetch', 'origin', 'main');

  assert.deepEqual(await branchUpdateState(work), {
    branch: 'main', revision: git(work, 'rev-parse', 'HEAD'), mainRevision: git(work, 'rev-parse', 'origin/main'),
    behind: 1, ahead: 0, clean: true, available: true,
  });

  const localRevision = git(work, 'rev-parse', 'HEAD');
  writeFileSync(path.join(peer, 'remote-again.txt'), 'incoming again\n');
  git(peer, 'add', 'remote-again.txt');
  git(peer, 'commit', '-m', 'incoming again');
  git(peer, 'push', 'origin', 'main');
  git(work, 'fetch', 'origin', 'main');
  const advancedRemote = await branchUpdateState(work);
  assert.equal(advancedRemote.revision, localRevision);
  assert.notEqual(advancedRemote.mainRevision, localRevision);
  assert.equal(advancedRemote.behind, 2);

  await assert.rejects(() => requestBranchUpdate(work, true), /Another Edit tab is active/);
  assert.equal(existsSync(path.join(work, '.dev-session/branch-sync.request')), false);

  await requestBranchUpdate(work);
  assert.equal(existsSync(path.join(work, '.dev-session/branch-sync.request')), true);

  writeFileSync(path.join(work, 'local.txt'), 'local\n');
  const dirty = await branchUpdateState(work);
  assert.equal(dirty.clean, false);
  assert.equal(dirty.available, false);
  await assert.rejects(() => requestBranchUpdate(work), /Publish or revert local files/);

  git(work, 'remote', 'remove', 'origin');
  const missingMain = await branchUpdateState(work);
  assert.equal(missingMain.revision, localRevision);
  assert.equal(missingMain.mainRevision, null);
  assert.equal(missingMain.available, false);

  console.log('PASS: branch update state and request gate');
} finally {
  rmSync(root, { recursive: true, force: true });
}
