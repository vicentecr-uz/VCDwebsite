// @ts-check
/**
 * Dev-only: commit scoped engine paths from the save bar (issue #109).
 * Content still publishes via /api/publish; this is for files like
 * `src/styles/global.css` that are engine and must not ride content publish.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/** Paths the save bar is allowed to commit. Keep this list short and explicit. */
const ALLOWED_ENGINE_PATHS = new Set(['src/styles/global.css']);

const git = async (...args) => {
  const { stdout } = await execFile('git', args, { cwd: process.cwd() });
  return stdout.trim();
};

const gitRaw = async (...args) => {
  const { stdout } = await execFile('git', args, { cwd: process.cwd() });
  return stdout;
};

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

async function dirtyAllowedEngineFiles() {
  const porcelain = await gitRaw('status', '--porcelain', '--', ...ALLOWED_ENGINE_PATHS);
  return porcelain
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^..\s+/, '').replace(/^.* -> /, ''))
    .filter((file) => ALLOWED_ENGINE_PATHS.has(file));
}

async function statusPayload() {
  const files = await dirtyAllowedEngineFiles();
  return { files, dirty: files.length > 0 };
}

/**
 * @param {{ paths?: string[], message?: string }} payload
 */
async function commitEngine(payload) {
  const requested = Array.isArray(payload.paths) ? payload.paths.map(String) : [];
  const paths = requested.length
    ? requested.filter((file) => ALLOWED_ENGINE_PATHS.has(file))
    : await dirtyAllowedEngineFiles();

  if (!paths.length) {
    throw new Error('Nothing to commit.');
  }
  for (const file of paths) {
    if (!ALLOWED_ENGINE_PATHS.has(file)) {
      throw new Error(`Refusing to commit '${file}'.`);
    }
  }

  const dirty = await dirtyAllowedEngineFiles();
  const toCommit = paths.filter((file) => dirty.includes(file));
  if (!toCommit.length) {
    throw new Error('Those files have no uncommitted changes.');
  }

  await git('add', '--', ...toCommit);
  const message = String(payload.message || '').trim()
    || (toCommit.length === 1 && toCommit[0] === 'src/styles/global.css'
      ? 'Update colour tokens in global.css'
      : `Update ${toCommit.join(', ')}`);

  try {
    await git('commit', '-m', message, '--', ...toCommit);
  } catch (error) {
    // Nothing staged (race) — surface cleanly.
    const detail = error instanceof Error ? error.message : String(error);
    if (/nothing to commit/i.test(detail)) {
      throw new Error('Nothing to commit.');
    }
    throw error;
  }

  return { ok: true, files: toCommit, message };
}

/** @returns {import('vite').Plugin} */
export function commitEngineDevWriter() {
  return {
    name: 'commit-engine-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/commit-engine', async (req, res, next) => {
        if (req.method === 'GET') {
          try {
            send(res, 200, await statusPayload());
          } catch (error) {
            send(res, 500, {
              error: error instanceof Error ? error.message : 'Could not read engine status.',
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
          send(res, 200, await commitEngine(payload));
        } catch (error) {
          send(res, 500, {
            error: error instanceof Error ? error.message : 'Could not commit.',
          });
        }
      });
    },
  };
}
