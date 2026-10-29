import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CONTENT_REPO_PATHS, contentGitArgs, hasContentRepository } from '../content-repository.mjs';
import { prepareContentSnapshot } from '../content-snapshot.mjs';

const execFile = promisify(execFileCallback);
const git = (cwd, ...args) => execFile('git', args, { cwd });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-content-snapshot-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  await mkdir(path.join(source, '.content.git'), { recursive: true });
  await mkdir(destination, { recursive: true });
  await git(destination, 'init');
  await git(destination, 'config', 'user.email', 'test@example.com');
  await git(destination, 'config', 'user.name', 'Snapshot Test');
  await writeFile(path.join(destination, 'README.md'), 'engine\n');
  await git(destination, 'add', 'README.md');
  await git(destination, 'commit', '-m', 'initial');
  await mkdir(path.join(source, 'src/content'), { recursive: true });
  await mkdir(path.join(source, 'media/private'), { recursive: true });
  await mkdir(path.join(source, 'public/images'), { recursive: true });
  await mkdir(path.join(source, 'docs'), { recursive: true });
  await writeFile(path.join(source, 'src/content/project.json'), '{"title":"source"}\n');
  await writeFile(path.join(source, 'media/private/secret.txt'), 'private bytes\n');
  await writeFile(path.join(source, 'public/images/image.txt'), 'image bytes\n');
  return { root, source, destination };
}

try {
  const { root, source, destination } = await fixture();
  try {
    const result = await prepareContentSnapshot(destination, source);
    assert.equal(result.copied, true);
    for (const relative of ['src/content/project.json', 'media/private/secret.txt', 'public/images/image.txt']) {
      assert.equal(await readFile(path.join(destination, relative), 'utf8'), await readFile(path.join(source, relative), 'utf8'));
    }
    assert.equal(await readFile(path.join(source, 'src/content/project.json'), 'utf8'), '{"title":"source"}\n');
    assert.equal(CONTENT_REPO_PATHS.includes('.content.git'), false);

    await writeFile(path.join(destination, 'src/content/project.json'), '{"title":"edited"}\n');
    const rerun = await prepareContentSnapshot(destination, source);
    assert.equal(rerun.preserved, true);
    assert.equal(await readFile(path.join(destination, 'src/content/project.json'), 'utf8'), '{"title":"edited"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const failing = await fixture();
  try {
    await mkdir(path.join(failing.destination, 'src/content'), { recursive: true });
    await writeFile(path.join(failing.destination, 'src/content/private.json'), 'keep me\n');
    await writeFile(path.join(failing.source, 'src/content/private.json'), 'replace me\n');
    await assert.rejects(() => prepareContentSnapshot(failing.destination, failing.source), /private destination path/);
    assert.equal(await readFile(path.join(failing.destination, 'src/content/private.json'), 'utf8'), 'keep me\n');
    assert.equal(await readFile(path.join(failing.destination, 'src/content/project.json'), 'utf8').catch(() => ''), '');
  } finally {
    await rm(failing.root, { recursive: true, force: true });
  }

  const guarded = await fixture();
  try {
    await symlink('missing-content-git', path.join(guarded.destination, '.content.git'));
    assert.throws(() => hasContentRepository(guarded.destination));
    assert.throws(() => contentGitArgs(guarded.destination));
    await assert.rejects(() => prepareContentSnapshot(guarded.destination, guarded.source), /Invalid \.content\.git/);
  } finally {
    await rm(guarded.root, { recursive: true, force: true });
  }
  const marked = await fixture();
  try {
    await mkdir(path.join(marked.destination, '.dev-session'), { recursive: true });
    await writeFile(path.join(marked.destination, '.dev-session/content-snapshot.json'), '{}\n');
    await mkdir(path.join(marked.destination, '.content.git'), { recursive: true });
    await assert.rejects(() => prepareContentSnapshot(marked.destination, marked.source), /content repository/);
  } finally {
    await rm(marked.root, { recursive: true, force: true });
  }
  const linkedRoot = await mkdtemp(path.join(os.tmpdir(), 'vcd-content-linked-'));
  try {
    const primary = path.join(linkedRoot, 'primary');
    const linked = path.join(linkedRoot, 'linked');
    await mkdir(primary, { recursive: true });
    await git(primary, 'init');
    await git(primary, 'config', 'user.email', 'test@example.com');
    await git(primary, 'config', 'user.name', 'Snapshot Test');
    await writeFile(path.join(primary, 'README.md'), 'engine\n');
    await git(primary, 'add', 'README.md');
    await git(primary, 'commit', '-m', 'initial');
    await git(primary, 'worktree', 'add', '-b', 'linked-test', linked);
    await mkdir(path.join(primary, '.content.git'), { recursive: true });
    await mkdir(path.join(primary, 'src/content'), { recursive: true });
    await writeFile(path.join(primary, 'src/content/linked.json'), '{"linked":true}\n');
    await prepareContentSnapshot(linked);
    assert.equal(await readFile(path.join(linked, 'src/content/linked.json'), 'utf8'), '{"linked":true}\n');
  } finally {
    await rm(linkedRoot, { recursive: true, force: true });
  }
  console.log('All checks passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
