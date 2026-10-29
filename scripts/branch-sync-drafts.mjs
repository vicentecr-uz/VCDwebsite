import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTENT_REPO_PATHS, contentGitArgs, hasContentRepository, isReviewPreview } from './content-repository.mjs';

const isContentPath = (file) => CONTENT_REPO_PATHS.some((root) => file === root || file.startsWith(`${root}/`));
const operations = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'];

export function updateWithDrafts(cwd, upstream) {
  if (isReviewPreview(cwd)) throw new Error('Updates are unavailable in a review preview.');
  const separate = hasContentRepository(cwd);
  const makeRepository = (name, prefix, target, scopes) => {
    const git = (...args) => execFileSync('git', [...prefix, ...args], {
      cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    }).trimEnd();
    if (operations.some((name) => existsSync(path.resolve(cwd, git('rev-parse', '--git-path', name))))) {
      throw new Error('Finish the existing Git operation before updating. Your files are unchanged.');
    }
    return { name, git, scopes, head: git('rev-parse', 'HEAD'), target: git('rev-parse', target), stash: null, untracked: [] };
  };
  const repositories = [makeRepository('engine', [], upstream, [])];
  if (separate) {
    const content = makeRepository('content', contentGitArgs(cwd), 'origin/main', CONTENT_REPO_PATHS);
    if (content.git('branch', '--show-current') !== 'main') throw new Error('Content checkout must be on main. Your files are unchanged.');
    repositories.push(content);
    const contentFiles = [
      ...content.git('ls-files', '--cached', '--others', '-z', '--', ...CONTENT_REPO_PATHS).split('\0'),
      ...content.git('ls-tree', '-r', '--name-only', '-z', content.head).split('\0'),
    ];
    content.scopes = CONTENT_REPO_PATHS.filter((root) => contentFiles.some((file) => file === root || file.startsWith(`${root}/`)));
    const engineUntracked = repositories[0].git('ls-files', '--others', '--exclude-standard', '-z').split('\0');
    if (engineUntracked.some((file) => isContentPath(file) || file.startsWith('.content.git/'))) {
      throw new Error('The engine must ignore content paths before updating. Your files are unchanged.');
    }
    for (const repository of repositories) {
      const files = new Set(repository.git('ls-files', '-z').split('\0').filter(Boolean));
      for (const ref of [repository.head, repository.target]) {
        for (const file of repository.git('ls-tree', '-r', '--name-only', '-z', ref).split('\0').filter(Boolean)) files.add(file);
      }
      if ([...files].some((file) => isContentPath(file) !== (repository.name === 'content'))) {
        throw new Error('Engine and content paths overlap. Your files are unchanged.');
      }
    }
  }

  let replaying = false;
  try {
    for (const repository of repositories) {
      const { git, scopes, name } = repository;
      if (name === 'content' && !scopes.length) continue;
      repository.untracked = git('ls-files', '--others', ...(name === 'engine' ? ['--exclude-standard'] : []), '-z', '--', ...scopes)
        .split('\0').filter(Boolean);
      const previous = git('stash', 'list', '--format=%H', '-1');
      try {
        git('stash', 'push', name === 'content' ? '--all' : '--include-untracked',
          '-m', `branch-sync ${name} drafts before ${repository.head}`, ...(scopes.length ? ['--', ...scopes] : []));
      } finally {
        const current = git('stash', 'list', '--format=%H', '-1');
        if (current && current !== previous) repository.stash = current;
      }
    }
    replaying = true;
    for (const { git, target } of repositories) {
      git('-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', 'rebase', '--no-autostash', '--rebase-merges', target);
    }
    for (const { git, stash } of repositories) if (stash) git('stash', 'apply', '--index', stash);
  } catch (error) {
    try {
      for (const { git, head, stash } of repositories) {
        // Before replay, an unsuccessful backup may have left its files untouched.
        if (!replaying && !stash) continue;
        if (['rebase-merge', 'rebase-apply'].some((name) => existsSync(path.resolve(cwd, git('rev-parse', '--git-path', name))))) git('rebase', '--abort');
        git('reset', '--hard', head);
      }
      for (const { git, stash, untracked } of repositories) {
        if (!stash) continue;
        // Only remove paths this backup owns, including partially restored new media.
        for (const file of untracked) rmSync(path.join(cwd, file), { force: true });
        git('stash', 'apply', '--index', stash);
      }
    } catch (recoveryError) {
      const backups = repositories.map(({ name, head, stash }) => `${name}: revision ${head}, backup ${stash || 'none'}`).join('; ');
      throw new Error(`Update recovery needs attention. ${backups}. ${recoveryError.message}`);
    }
    for (const repository of repositories) dropBackup(repository);
    throw new Error('Update conflicted and was cancelled. Your previous revision and drafts were restored.');
  }
  for (const repository of repositories) dropBackup(repository);
}

function dropBackup({ git, stash }) {
  if (!stash) return;
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
