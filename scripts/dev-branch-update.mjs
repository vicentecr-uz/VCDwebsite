// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const git = async (cwd, ...args) => {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
};

export async function branchUpdateState(cwd = process.cwd()) {
  const branch = await git(cwd, 'branch', '--show-current') || 'detached HEAD';
  let behind = 0;
  let ahead = 0;
  try {
    const counts = (await git(cwd, 'rev-list', '--left-right', '--count', 'HEAD...origin/main'))
      .split(/\s+/)
      .map(Number);
    [ahead, behind] = counts;
  } catch {
    return { branch, behind, ahead, clean: false, available: false };
  }

  const clean = !(await git(cwd, 'status', '--porcelain'));
  return {
    branch,
    behind,
    ahead,
    clean,
    available: branch === 'main' && behind > 0 && ahead === 0 && clean,
  };
}

export async function requestBranchUpdate(cwd = process.cwd(), authoringActive = false) {
  if (authoringActive) throw new Error('Another Edit tab is active.');

  const state = await branchUpdateState(cwd);
  if (state.branch !== 'main') throw new Error('Updates are available only on main.');
  if (!state.clean) throw new Error('Publish or revert local files before updating.');
  if (state.ahead > 0) throw new Error('Local main is ahead of origin/main.');
  if (!state.behind) throw new Error('Already up to date.');

  const sessionDir = path.join(cwd, '.dev-session');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'branch-sync.request'), `${new Date().toISOString()}\n`);
  return state;
}

export function branchUpdateDevWriter({ authoringActive = () => false } = {}) {
  return {
    name: 'vcd-dev-branch-update',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/dev-branch-update', async (req, res, next) => {
        const send = (status, payload) => {
          res.statusCode = status;
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
