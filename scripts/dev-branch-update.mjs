// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { CONTENT_REPO_PATHS, contentGitArgs, hasContentRepository, isReviewPreview } from './content-repository.mjs';

const execFile = promisify(execFileCb);

const git = async (cwd, ...args) => {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
};

const contentGit = async (cwd, ...args) => {
  const { stdout } = await execFile('git', [...contentGitArgs(cwd), ...args], { cwd });
  return stdout.trim();
};

const readUpdateStatus = async (cwd) => {
  try { return JSON.parse(await readFile(path.join(cwd, '.dev-session/branch-sync.status'), 'utf8')); } catch { return null; }
};

const hasGitOperation = async (cwd, run = git) => {
  for (const name of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']) {
    try { await access(path.resolve(cwd, await run(cwd, 'rev-parse', '--git-path', name))); return true; } catch {}
  }
  return false;
};

export async function branchUpdateState(cwd = process.cwd()) {
  const branch = await git(cwd, 'branch', '--show-current') || 'detached HEAD';
  const separateContent = hasContentRepository(cwd);
  const content = separateContent ? await readContentState(cwd) : null;
  const clean = !(await git(cwd, 'status', '--porcelain')) && (!content || content.clean);
  let revision;
  try {
    revision = await git(cwd, 'rev-parse', 'HEAD');
  } catch {
    return { branch, revision: null, mainRevision: null, behind: 0, ahead: 0, clean, available: false, ...(content || {}) };
  }

  let mainRevision;
  try {
    mainRevision = await git(cwd, 'rev-parse', 'origin/main');
  } catch {
    return { branch, revision, mainRevision: null, behind: 0, ahead: 0, clean, available: false, ...(content || {}) };
  }

  let behind = 0;
  let ahead = 0;
  try {
    const counts = (await git(cwd, 'rev-list', '--left-right', '--count', `${revision}...${mainRevision}`))
      .split(/\s+/)
      .map(Number);
    [ahead, behind] = counts;
  } catch {
    return { branch, revision, mainRevision: null, behind, ahead, clean: false, available: false, ...(content || {}) };
  }

  const update = await readUpdateStatus(cwd);
  const gitBusy = await hasGitOperation(cwd) || Boolean(content?.contentBusy);
  const contentBehind = content?.contentBehind || 0;
  return {
    branch,
    revision,
    mainRevision: separateContent && !content?.contentMainRevision ? null : mainRevision,
    engineBehind: behind,
    engineAhead: ahead,
    behind: behind + contentBehind,
    ahead: ahead + (content?.contentAhead || 0),
    clean,
    contentBehind,
    contentBusy: Boolean(content?.contentBusy),
    contentAhead: content?.contentAhead || 0,
    contentBranch: content?.contentBranch || null,
    contentRevision: content?.contentRevision || null,
    contentMainRevision: content?.contentMainRevision || null,
    readOnly: isReviewPreview(cwd),
    available: branch === 'main' && (!separateContent || content?.contentBranch === 'main') && (behind > 0 || contentBehind > 0) && !gitBusy && !isReviewPreview(cwd),
    update,
  };
}

async function readContentState(cwd) {
  let branch;
  let contentRevision;
  let contentMainRevision;
  try {
    branch = await contentGit(cwd, 'branch', '--show-current');
    contentRevision = await contentGit(cwd, 'rev-parse', 'HEAD');
    contentMainRevision = await contentGit(cwd, 'rev-parse', 'origin/main');
  } catch {
    return { contentBranch: null, contentRevision: null, contentMainRevision: null, contentBehind: 0, contentAhead: 0, clean: false, contentBusy: true };
  }
  let contentBehind = 0;
  let contentAhead = 0;
  try {
    [contentAhead, contentBehind] = (await contentGit(cwd, 'rev-list', '--left-right', '--count', `${contentRevision}...${contentMainRevision}`)).split(/\s+/).map(Number);
  } catch {
    return { contentBranch: branch, contentRevision, contentMainRevision, contentBehind: 0, contentAhead: 0, clean: false, contentBusy: true };
  }
  const clean = !(await contentGit(cwd, 'status', '--porcelain', '--untracked-files=all', '--ignored', '--', ...CONTENT_REPO_PATHS));
  const contentBusy = await hasGitOperation(cwd, contentGit);
  return { contentBranch: branch, contentRevision, contentMainRevision, contentBehind, contentAhead, clean, contentBusy };
}

export async function requestBranchUpdate(cwd = process.cwd(), authoringActive = false) {
  if (authoringActive) throw new Error('Another Edit tab is active.');

  const state = await branchUpdateState(cwd);
  if (state.branch !== 'main') throw new Error('Updates are available only on main.');
  if (await hasGitOperation(cwd)) throw new Error('Finish the current Git operation before updating.');
  if (hasContentRepository(cwd) && state.contentBranch !== 'main') throw new Error('Content updates are available only on main.');
  if (state.contentBusy) throw new Error('Finish the current Git operation before updating.');
  if (!state.behind && !state.contentBehind) throw new Error('Already up to date.');
  if (state.readOnly) throw new Error('Updates are unavailable in a review preview.');

  const sessionDir = path.join(cwd, '.dev-session');
  await mkdir(sessionDir, { recursive: true });
  const requestLock = path.join(sessionDir, 'branch-sync.request-lock');
  try { await mkdir(requestLock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('An update is already in progress.');
    throw error;
  }
  const requestId = randomUUID();
  const temporary = path.join(sessionDir, `branch-sync.${requestId}.tmp`);
  try {
    for (const name of ['branch-sync.request', 'branch-sync.lock']) {
      let exists = false;
      try { await access(path.join(sessionDir, name)); exists = true; } catch {}
      if (exists) throw new Error('An update is already in progress.');
    }
    await writeFile(temporary, JSON.stringify({ id: requestId, state: 'pending', message: 'Queued.' }) + '\n');
    await rename(temporary, path.join(sessionDir, 'branch-sync.status'));
    await writeFile(temporary, JSON.stringify({ id: requestId }) + '\n');
    await rename(temporary, path.join(sessionDir, 'branch-sync.request'));
    return { ...state, requestId };
  } finally {
    await rm(temporary, { force: true });
    await rm(requestLock, { recursive: true });
  }
}

export function branchUpdateDevWriter({ authoringActive = () => false } = {}) {
  return {
    name: 'vcd-dev-branch-update',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/dev-branch-update', async (req, res, next) => {
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('cache-control', 'no-store');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method === 'GET') {
          try {
            send(200, await branchUpdateState());
          } catch {
            send(503, { error: 'Could not check for updates.' });
          }
          return;
        }

        if (req.method === 'POST') {
          try {
            const state = await requestBranchUpdate(process.cwd(), authoringActive());
            send(202, { ok: true, ...state });
          } catch (error) {
            send(409, { error: error instanceof Error ? error.message : 'Could not request the update.' });
          }
          return;
        }

        next();
      });
    },
  };
}
