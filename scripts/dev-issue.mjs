// @ts-check
/**
 * Dev-only GitHub issue filing from the page (issue #107).
 *
 * POST /api/dev-issue — create an issue via `gh`, optionally pushing attachments
 * to the orphan `issue-assets` branch first (private-repo-safe clickable links).
 * GET  /api/dev-issue — labels + milestones + current branch for the form.
 */
import { execFile as execFileCb } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const REPO = 'vicentecr-uz/VCDwebsite';
const ASSETS_BRANCH = 'issue-assets';
// No hardcoded label list: listMeta() pulls every label straight from the
// repo on each load, so a label created on GitHub shows up here without a
// code change. The only split kept is "page" labels (name contains "page")
// vs everything else, purely to keep the form's two dropdowns meaningful.

const git = async (...args) => {
  const { stdout } = await execFile('git', args, { cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
};

const gitWithEnv = async (env, ...args) => {
  const { stdout } = await execFile('git', args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim();
};

const gh = async (...args) => {
  const { stdout } = await execFile('gh', args, {
    cwd: process.cwd(),
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
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

const send = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
};

/** Safe filename: keep extension, drop path tricks. */
function sanitizeFilename(name) {
  const base = path.basename(String(name || 'attachment')).replace(/[^\w.\-()+ ]+/g, '_');
  return base.slice(0, 120) || 'attachment';
}

/**
 * Commit files onto the orphan `issue-assets` branch without touching the
 * working tree / index (scratch GIT_INDEX_FILE, same idea as cross-branch publish).
 *
 * @param {Array<{ filename: string, data: string, mimeType?: string }>} files
 * @returns {Promise<Array<{ filename: string, path: string, url: string }>>}
 */
async function pushIssueAssets(files) {
  if (!files.length) return [];

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = `uploads/${stamp}-${randomUUID().slice(0, 8)}`;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vcd-issue-assets-'));
  const indexFile = path.join(tmpDir, 'index');
  const env = { GIT_INDEX_FILE: indexFile };

  /** @type {Array<{ filename: string, path: string, url: string, localPath: string }>} */
  const written = [];

  try {
    let parent = null;
    try {
      await git('fetch', 'origin', ASSETS_BRANCH);
      parent = await git('rev-parse', `origin/${ASSETS_BRANCH}`);
      await gitWithEnv(env, 'read-tree', parent);
    } catch {
      // First upload: scratch GIT_INDEX_FILE starts empty — do not touch
      // the real index (never run read-tree without GIT_INDEX_FILE).
      parent = null;
    }

    for (const file of files) {
      const filename = sanitizeFilename(file.filename);
      const relPath = `${folder}/${filename}`;
      const localPath = path.join(tmpDir, filename);
      const buffer = Buffer.from(String(file.data || ''), 'base64');
      if (!buffer.length) continue;
      await fs.writeFile(localPath, buffer);
      const blob = await gitWithEnv(env, 'hash-object', '-w', localPath);
      await gitWithEnv(env, 'update-index', '--add', '--cacheinfo', `100644,${blob},${relPath}`);
      written.push({
        filename,
        path: relPath,
        url: `https://github.com/${REPO}/blob/${ASSETS_BRANCH}/${relPath}`,
        localPath,
      });
    }

    if (!written.length) return [];

    const tree = await gitWithEnv(env, 'write-tree');
    const message = `issue-assets: ${written.length} file${written.length === 1 ? '' : 's'}`;
    const commitArgs = parent
      ? ['commit-tree', tree, '-p', parent, '-m', message]
      : ['commit-tree', tree, '-m', message];
    const commit = await gitWithEnv(env, ...commitArgs);
    await git('push', 'origin', `${commit}:refs/heads/${ASSETS_BRANCH}`);

    return written.map(({ filename, path: assetPath, url }) => ({ filename, path: assetPath, url }));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function currentBranch() {
  try {
    return await git('branch', '--show-current') || 'detached HEAD';
  } catch {
    return 'unknown';
  }
}

async function listMeta() {
  const [branch, labelsRaw, milestonesRaw] = await Promise.all([
    currentBranch(),
    gh('label', 'list', '--repo', REPO, '--json', 'name', '--limit', '50'),
    gh('api', `repos/${REPO}/milestones?state=open`, '--jq', '.'),
  ]);

  const repoLabels = JSON.parse(labelsRaw).map((row) => row.name);
  const isPageLabel = (name) => /page/i.test(name);

  const labels = repoLabels
    .filter((name) => !isPageLabel(name))
    .sort((a, b) => a.localeCompare(b));

  const pageLabels = repoLabels
    .filter(isPageLabel)
    .sort((a, b) => a.localeCompare(b));

  const milestones = JSON.parse(milestonesRaw)
    .map((row) => ({ number: row.number, title: row.title }))
    .sort((a, b) => a.number - b.number);

  return { branch, labels, pageLabels, milestones, repo: REPO };
}

/**
 * @param {{
 *   title: string,
 *   body: string,
 *   label: string,
 *   pageLabel?: string,
 *   milestone: string | number,
 *   attachments?: Array<{ filename: string, data: string, mimeType?: string }>,
 * }} payload
 */
async function createIssue(payload) {
  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  const label = String(payload.label || '').trim();
  const pageLabel = String(payload.pageLabel || '').trim();
  const milestone = String(payload.milestone || '').trim();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  if (!title) throw new Error('Title is required.');
  if (!body) throw new Error('Description is required.');
  if (!label) throw new Error('Pick a label.');
  if (!milestone) throw new Error('Pick a milestone.');

  const uploaded = await pushIssueAssets(attachments);

  let fullBody = body;
  if (uploaded.length) {
    const lines = uploaded.map((file) => `- [${file.filename}](${file.url})`);
    fullBody += `\n\n### Attachments\n${lines.join('\n')}`;
  }

  // Write body to a temp file so newlines / quotes survive the shell.
  const bodyFile = path.join(os.tmpdir(), `vcd-issue-body-${randomUUID()}.md`);
  await fs.writeFile(bodyFile, fullBody, 'utf8');

  try {
    const ghArgs = [
      'issue',
      'create',
      '--repo', REPO,
      '--title', title,
      '--body-file', bodyFile,
      '--label', label,
      '--milestone', milestone,
    ];
    if (pageLabel) ghArgs.push('--label', pageLabel);
    const url = await gh(...ghArgs);
    const match = /\/issues\/(\d+)\s*$/.exec(url) || /\/issues\/(\d+)/.exec(url);
    const number = match ? Number(match[1]) : null;
    return { ok: true, url: url.trim(), number, attachments: uploaded };
  } finally {
    await fs.unlink(bodyFile).catch(() => {});
  }
}

/** @returns {import('vite').Plugin} */
export function issueDevWriter() {
  return {
    name: 'issue-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/dev-issue', async (req, res, next) => {
        if (req.method === 'GET') {
          try {
            send(res, 200, await listMeta());
          } catch (error) {
            send(res, 500, {
              error: error instanceof Error ? error.message : 'Could not load issue meta.',
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
          const result = await createIssue(payload);
          send(res, 200, result);
        } catch (error) {
          send(res, 500, {
            error: error instanceof Error ? error.message : 'Could not create the issue.',
          });
        }
      });
    },
  };
}
