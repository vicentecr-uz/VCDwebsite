import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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

  const initial = await branchUpdateState(work);
  assert.equal(initial.branch, 'main');
  assert.equal(initial.available, false);
  assert.equal(initial.clean, true);

  writeFileSync(path.join(peer, 'remote.txt'), 'incoming\n');
  git(peer, 'add', 'remote.txt');
  git(peer, 'commit', '-m', 'incoming');
  git(peer, 'push', 'origin', 'main');
  git(work, 'fetch', 'origin', 'main');

  const available = await branchUpdateState(work);
  assert.equal(available.behind, 1);
  assert.equal(available.ahead, 0);
  assert.equal(available.available, true);

  git(work, 'switch', '-c', 'feature');
  assert.equal((await branchUpdateState(work)).available, false);
  git(work, 'switch', 'main');

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

  const request = await requestBranchUpdate(work);
  assert.match(request.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(existsSync(path.join(work, '.dev-session/branch-sync.request')), true);
  assert.deepEqual(JSON.parse(readFileSync(path.join(work, '.dev-session/branch-sync.status'), 'utf8')), {
    id: request.requestId, state: 'pending', message: 'Queued.',
  });
  await assert.rejects(() => requestBranchUpdate(work), /already in progress/);

  writeFileSync(path.join(work, 'local.txt'), 'local\n');
  const dirty = await branchUpdateState(work);
  assert.equal(dirty.clean, false);
  assert.equal(dirty.available, true);

  git(work, 'add', 'local.txt');
  git(work, 'commit', '-m', 'local draft commit');
  writeFileSync(path.join(work, 'staged-and-dirty.txt'), 'draft\n');
  writeFileSync(path.join(work, 'local.txt'), 'local changed\n');
  writeFileSync(path.join(work, '.dev-session/branch-sync.status'), JSON.stringify({ id: request.requestId, state: 'succeeded', message: 'done' }));
  unlinkSync(path.join(work, '.dev-session/branch-sync.request'));
  const aheadAndDirty = await branchUpdateState(work);
  assert.equal(aheadAndDirty.ahead, 1);
  assert.equal(aheadAndDirty.clean, false);
  assert.equal(aheadAndDirty.available, true);
  const secondRequest = await requestBranchUpdate(work);
  assert.notEqual(secondRequest.requestId, request.requestId);

  const mergeHead = path.resolve(work, git(work, 'rev-parse', '--git-path', 'MERGE_HEAD'));
  writeFileSync(mergeHead, `${git(work, 'rev-parse', 'HEAD')}\n`);
  assert.equal((await branchUpdateState(work)).available, false);
  await assert.rejects(() => requestBranchUpdate(work), /current Git operation/);
  unlinkSync(mergeHead);

  const linked = path.join(root, 'linked');
  git(work, 'worktree', 'add', '--force', linked, 'main');
  assert.equal((await branchUpdateState(linked)).available, true);
  const linkedMerge = path.resolve(linked, git(linked, 'rev-parse', '--git-path', 'MERGE_HEAD'));
  writeFileSync(linkedMerge, `${git(work, 'rev-parse', 'HEAD')}\n`);
  assert.equal((await branchUpdateState(linked)).available, false);
  unlinkSync(linkedMerge);
  git(work, 'worktree', 'remove', linked);

  unlinkSync(path.join(work, '.dev-session/branch-sync.request'));
  const concurrent = await Promise.allSettled([requestBranchUpdate(work), requestBranchUpdate(work)]);
  assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((entry) => entry.status === 'rejected').length, 1);
  const winning = concurrent.find((entry) => entry.status === 'fulfilled').value;
  assert.equal((await branchUpdateState(work)).update.id, winning.requestId);

  git(work, 'remote', 'remove', 'origin');
  const missingMain = await branchUpdateState(work);
  assert.equal(missingMain.revision, git(work, 'rev-parse', 'HEAD'));
  assert.equal(missingMain.mainRevision, null);
  assert.equal(missingMain.available, false);

  console.log('PASS: branch update state and request gate');
} finally {
  rmSync(root, { recursive: true, force: true });
}
