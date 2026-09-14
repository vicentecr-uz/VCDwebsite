import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function updateWithDrafts(cwd, upstream) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
  const operations = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'];
  if (operations.some((name) => existsSync(path.resolve(cwd, git('rev-parse', '--git-path', name))))) {
    throw new Error('Finish the existing Git operation before updating. Your files are unchanged.');
  }
  const originalHead = git('rev-parse', 'HEAD');
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  let stash;
  let changed = false;
  try {
    if (git('status', '--porcelain')) {
      const previous = git('stash', 'list', '--format=%H', '-1');
      git('stash', 'push', '--include-untracked', '-m', `branch-sync drafts before ${originalHead}`);
      stash = git('rev-parse', 'refs/stash');
      if (stash === previous) throw new Error('Could not create a draft backup.');
    }
    changed = true;
    git('-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', 'rebase', '--no-autostash', '--rebase-merges', upstream);
    if (stash) git('stash', 'apply', '--index', stash);
  } catch (error) {
    if (!changed) throw error;
    try {
      if (['rebase-merge', 'rebase-apply'].some((name) => existsSync(path.resolve(cwd, git('rev-parse', '--git-path', name))))) {
        git('rebase', '--abort');
      }
      git('reset', '--hard', originalHead);
      if (stash) {
        // Remove only original untracked paths partially restored by stash apply; their backup remains in Git.
        for (const file of untracked) {
          try { rmSync(path.join(cwd, file), { force: true }); } catch (cleanupError) {
            if (!['ENOENT', 'ENOTDIR'].includes(cleanupError.code)) throw cleanupError;
          }
        }
        git('stash', 'apply', '--index', stash);
      }
    } catch (recoveryError) {
      throw new Error(`Update recovery needs attention. Draft backup: ${stash || 'none'}; previous revision: ${originalHead}. ${recoveryError.message}`);
    }
    if (stash) dropBackup(git, stash);
    throw new Error('Update conflicted and was cancelled. Your previous revision and drafts were restored.');
  }
  if (stash) dropBackup(git, stash);
}

function dropBackup(git, stash) {
  const entry = git('stash', 'list', '--format=%gd %H').split('\n').find((line) => line.endsWith(` ${stash}`));
  if (entry) git('stash', 'drop', entry.split(' ')[0]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cwd, upstream] = process.argv.slice(2);
  const errorFile = path.join(cwd, '.dev-session/branch-sync.error');
  mkdirSync(path.dirname(errorFile), { recursive: true });
  rmSync(errorFile, { force: true });
  try { updateWithDrafts(cwd, upstream); } catch (error) {
    writeFileSync(errorFile, error.message);
    console.error(error.message);
    process.exitCode = 1;
  }
}
