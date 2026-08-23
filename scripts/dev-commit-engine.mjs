// @ts-check
/**
 * Dev-only: publish colour-token CSS (`src/styles/global.css`) to main from the
 * save bar (issue #109). Content still publishes via /api/publish; this path is
 * for the one engine file editors are allowed to push straight to main.
 *
 * Same scratch-index / push pattern as content publish — works from any branch
 * without switching checkout or staging engine work into a feature commit.
 */
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/** The only engine paths the save bar may publish to main. */
export const STYLE_TOKEN_PATHS = ['src/styles/global.css', 'tokens/design-tokens.json'];
const PUBLISH_BRANCH = 'main';
const DEFAULT_MESSAGE = 'styles: update colour tokens';

/** @param {string[]} tokens */
function buildSaveMessage(tokens) {
  const names = [...new Set(tokens.map((token) => String(token || '').trim()).filter(Boolean))];
  if (names.length === 1) return `styles: update ${names[0]}`;
  if (names.length > 1) return `styles: update colour tokens (${names.length})`;
  return DEFAULT_MESSAGE;
}

const gitRaw = async (...args) => {
  const { stdout } = await execFile('git', args, { cwd: process.cwd() });
  return stdout;
};

const git = async (...args) => (await gitRaw(...args)).trim();

const gitWithEnv = async (env, ...args) => {
  const { stdout } = await execFile('git', args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
  return stdout.trim();
};

const lines = (value) => value.split('\n').map((line) => line.trim()).filter(Boolean);

const send = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(raw ? JSON.parse(raw) : {});
    } catch (error) {
      reject(error);
    }
  });
  req.on('error', reject);
});

async function publishRecordPath() {
  const gitDir = await git('rev-parse', '--absolute-git-dir');
  return path.join(gitDir, 'vcd-last-publish.json');
}

async function readPublishRecord() {
  try {
    return JSON.parse(await readFile(await publishRecordPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function writePublishRecord(entries) {
  try {
    const record = { ...await readPublishRecord(), ...entries };
    await writeFile(await publishRecordPath(), `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // Bookkeeping only — never fail a publish that already landed.
  }
}

async function blobAt(ref, file) {
  try {
    return await git('rev-parse', `${ref}:${file}`);
  } catch {
    return null;
  }
}

async function publishBaseRef() {
  for (const ref of [`origin/${PUBLISH_BRANCH}`, PUBLISH_BRANCH]) {
    try {
      await execFile('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: process.cwd() });
      return ref;
    } catch {
      // try next
    }
  }
  return null;
}

async function staleFiles(files, target, mergeBase) {
  const record = await readPublishRecord();
  const stale = [];
  for (const file of files) {
    const theirs = await blobAt(target, file);
    if (Object.hasOwn(record, file) && record[file] === theirs) continue;
    if (theirs !== await blobAt(mergeBase, file)) stale.push(file);
  }
  return stale;
}

/**
 * Ahead of main = we edited it; behind = main moved and we have not.
 * Same split as content publish — only ahead is publishable.
 */
async function splitAheadBehind(files, target) {
  if (!files.length) return { files: [], behind: [] };

  const record = await readPublishRecord();
  let mergeBase = null;
  try {
    mergeBase = await git('merge-base', 'HEAD', target);
  } catch {
    // No shared history — treat differences as ours.
  }

  const ahead = [];
  const behind = [];
  for (const file of files) {
    const absolute = path.join(process.cwd(), file);
    const ours = existsSync(absolute) ? await git('hash-object', '--', absolute) : null;
    const lastSynced = Object.hasOwn(record, file)
      ? record[file]
      : (mergeBase ? await blobAt(mergeBase, file) : null);
    (ours === lastSynced ? behind : ahead).push(file);
  }
  return { files: ahead, behind };
}

async function unpublishedStyles() {
  const base = await publishBaseRef();

  if (!base) {
    const porcelain = await gitRaw('status', '--porcelain', '--', ...STYLE_TOKEN_PATHS);
    const files = porcelain
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/^..\s+/, '').replace(/^.* -> /, ''))
      .filter((file) => STYLE_TOKEN_PATHS.includes(file));
    return { files, behind: [] };
  }

  const changed = new Set();
  for (const file of lines(await git('diff', '--name-only', base, '--', ...STYLE_TOKEN_PATHS))) {
    changed.add(file);
  }
  for (const file of lines(await git('ls-files', '--others', '--exclude-standard', '--', ...STYLE_TOKEN_PATHS))) {
    changed.add(file);
  }
  return splitAheadBehind([...changed].sort(), base);
}

/** @returns {Promise<{ branch: string, files: string[], behind: string[], dirty: boolean, publishBranch: string, onPublishBranch: boolean }>} */
export async function stylesPublishStatus() {
  const branch = await git('branch', '--show-current');
  const { files, behind } = await unpublishedStyles();
  return {
    branch,
    files,
    behind,
    dirty: files.length > 0,
    publishBranch: PUBLISH_BRANCH,
    onPublishBranch: branch === PUBLISH_BRANCH,
  };
}

async function publishStylesInPlace(message) {
  const staged = lines(await git('diff', '--cached', '--name-only'));
  const strays = staged.filter((file) => !STYLE_TOKEN_PATHS.includes(file));
  if (strays.length) {
    return {
      ok: false,
      error: `Other files are staged (${strays.slice(0, 3).join(', ')}) — commit or unstage them first.`,
    };
  }

  await git('add', '--', ...STYLE_TOKEN_PATHS);
  const stagedNow = lines(await git('diff', '--cached', '--name-only'));
  if (!stagedNow.length || !stagedNow.some((file) => STYLE_TOKEN_PATHS.includes(file))) {
    return { ok: false, error: 'No style changes to publish.' };
  }

  await git('commit', '-m', message);

  try {
    await git('push', 'origin', PUBLISH_BRANCH);
  } catch (error) {
    return {
      ok: true,
      pushed: false,
      message,
      files: stagedNow,
      error: error instanceof Error ? error.message.split('\n')[0] : 'Push failed.',
    };
  }

  await writePublishRecord(
    Object.fromEntries(await Promise.all(
      stagedNow.map(async (file) => [file, await blobAt('HEAD', file)]),
    )),
  );

  return { ok: true, pushed: true, message, files: stagedNow };
}

async function publishStylesFromBranch(files, message) {
  try {
    await git('fetch', 'origin', PUBLISH_BRANCH);
  } catch {
    return { ok: false, error: `Could not reach origin to publish to ${PUBLISH_BRANCH}.` };
  }

  const target = `origin/${PUBLISH_BRANCH}`;
  const mergeBase = await git('merge-base', 'HEAD', target);
  const stale = await staleFiles(files, target, mergeBase);
  if (stale.length) {
    return {
      ok: false,
      error: `${PUBLISH_BRANCH} has newer edits to ${stale.slice(0, 3).join(', ')} — merge or rebase onto ${PUBLISH_BRANCH} first.`,
    };
  }

  const scratchIndex = path.join(os.tmpdir(), `vcd-styles-index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: scratchIndex };

  try {
    await gitWithEnv(env, 'read-tree', target);

    const published = {};
    for (const file of files) {
      const absolute = path.join(process.cwd(), file);
      if (existsSync(absolute)) {
        const blob = await gitWithEnv(env, 'hash-object', '-w', '--', absolute);
        await gitWithEnv(env, 'update-index', '--add', '--cacheinfo', `100644,${blob},${file}`);
        published[file] = blob;
      } else {
        await gitWithEnv(env, 'update-index', '--force-remove', '--', file);
        published[file] = null;
      }
    }

    const tree = await gitWithEnv(env, 'write-tree');
    if (tree === await git('rev-parse', `${target}^{tree}`)) {
      return { ok: false, error: 'No style changes to publish.' };
    }

    const commit = await gitWithEnv(env, 'commit-tree', tree, '-p', target, '-m', message);

    try {
      await git('push', 'origin', `${commit}:refs/heads/${PUBLISH_BRANCH}`);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message.split('\n').pop() || 'Push failed.' : 'Push failed.',
      };
    }

    await writePublishRecord(published);
    return {
      ok: true,
      pushed: true,
      message,
      files,
      branch: await git('branch', '--show-current'),
    };
  } finally {
    await rm(scratchIndex, { force: true });
  }
}

/**
 * Commit saved colour-token CSS on the current branch so disk, HEAD, and
 * Publish styles stay aligned. Publish still ships the same file to main.
 *
 * @param {{ tokens?: string[], message?: string }} [payload]
 */
export async function commitStyleTokensOnBranch(payload = {}) {
  const branch = await git('branch', '--show-current');
  if (!branch) {
    return { ok: false, error: 'On a detached HEAD — check out a branch to save styles.' };
  }

  const staged = lines(await git('diff', '--cached', '--name-only'));
  const strays = staged.filter((file) => !STYLE_TOKEN_PATHS.includes(file));
  if (strays.length) {
    return {
      ok: false,
      error: `Other files are staged (${strays.slice(0, 3).join(', ')}) — commit or unstage them first.`,
    };
  }

  const diffHead = await gitRaw('diff', 'HEAD', '--', ...STYLE_TOKEN_PATHS);
  if (!diffHead.trim()) {
    return { ok: true, skipped: true, message: 'Already committed.' };
  }

  const message = String(payload.message || '').trim()
    || buildSaveMessage(Array.isArray(payload.tokens) ? payload.tokens : []);

  await git('add', '--', ...STYLE_TOKEN_PATHS);
  const stagedNow = lines(await git('diff', '--cached', '--name-only'));
  if (!stagedNow.length || !stagedNow.some((file) => STYLE_TOKEN_PATHS.includes(file))) {
    return { ok: false, error: 'No style changes to commit.' };
  }

  await git('commit', '-m', message);
  return { ok: true, committed: true, message, files: stagedNow };
}

/**
 * @param {{ message?: string }} [payload]
 */
export async function publishStyles(payload = {}) {
  const status = await stylesPublishStatus();

  if (!status.branch) {
    return { ok: false, error: 'On a detached HEAD — check out a branch to publish.' };
  }
  if (!status.files.length) {
    return { ok: false, error: 'No style changes to publish.' };
  }

  const message = String(payload.message || '').trim() || DEFAULT_MESSAGE;

  return status.onPublishBranch
    ? publishStylesInPlace(message)
    : publishStylesFromBranch(status.files, message);
}

/** @returns {import('vite').Plugin} */
export function commitEngineDevWriter() {
  return {
    name: 'publish-styles-dev-writer',
    apply: 'serve',
    configureServer(server) {
      // Keep the old path as an alias so a mid-session reload still works.
      const handler = async (req, res, next) => {
        if (req.method === 'GET') {
          try {
            send(res, 200, await stylesPublishStatus());
          } catch (error) {
            send(res, 500, {
              error: error instanceof Error ? error.message : 'Could not read style status.',
            });
          }
          return;
        }

        if (req.method !== 'POST') {
          next();
          return;
        }

        try {
          const payload = await readJsonBody(req);
          const result = await publishStyles(payload);
          send(res, result.ok ? 200 : 409, result);
        } catch (error) {
          send(res, 500, {
            error: error instanceof Error ? error.message : 'Could not publish styles.',
          });
        }
      };

      server.middlewares.use('/api/publish-styles', handler);
      server.middlewares.use('/api/commit-engine', handler);

      server.middlewares.use('/api/style-token-commit', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        try {
          const payload = await readJsonBody(req);
          const result = await commitStyleTokensOnBranch(payload);
          send(res, result.ok ? 200 : 409, result);
        } catch (error) {
          send(res, 500, {
            error: error instanceof Error ? error.message : 'Could not commit style changes.',
          });
        }
      });
    },
  };
}
