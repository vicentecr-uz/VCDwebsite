// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/**
 * The content surface. Everything here publishes from the dev save bar straight
 * to main; everything else is engine work and belongs on a feature branch.
 * Keep in sync with scripts/commit-engine.sh and CLAUDE.md.
 */
export const CONTENT_PATHS = ['src/content', 'public/images'];
const PUBLISH_BRANCH = 'main';

/**
 * Commit subjects are written by a local model via Ollama — no API key, no cost,
 * no network. `gemma3:4b` was picked by benchmark: 1b hallucinated page names
 * (invented "John Doe", misspelled "Tapico"), which is disqualifying for text
 * that lands in permanent git history unattended. See Atlas learnings.md →
 * "Small-model benchmark for one-line commit subjects".
 *
 * Ollama runs as a login service (`brew services start ollama`). If it is not
 * running, publishing still works — see generateMessage().
 */
const MESSAGE_MODEL = 'gemma3:4b';
const OLLAMA_URL = 'http://localhost:11434/api/generate';
/** Cold start is ~6s once the 5-minute keep-alive lapses; warm is ~1s. */
const MESSAGE_TIMEOUT_MS = 20_000;

/** Raw stdout — porcelain output must not be trimmed, its first column is a space. */
const gitRaw = async (...args) => {
  const { stdout } = await execFile('git', args, { cwd: process.cwd() });
  return stdout;
};

const git = async (...args) => (await gitRaw(...args)).trim();

const lines = (value) => value.split('\n').map((line) => line.trim()).filter(Boolean);

const isContentPath = (file) => CONTENT_PATHS.some((dir) => file.startsWith(`${dir}/`));

/** `git add` errors on a pathspec that matches nothing, so only pass live ones. */
async function trackedContentPaths() {
  const present = [];
  for (const dir of CONTENT_PATHS) {
    try {
      await execFile('git', ['ls-files', '--error-unmatch', '--', dir], { cwd: process.cwd() });
      present.push(dir);
    } catch {
      // Nothing tracked under this path in this checkout — skip it.
    }
  }
  return present;
}

/**
 * `XY path`, or `XY old -> new` for renames. Git C-style-quotes any path with
 * a space or non-ASCII character, so unquote before the value is shown to
 * anyone or used to derive a page name.
 */
function porcelainPath(line) {
  const match = /^..\s(.*)$/.exec(line);
  if (!match) return null;
  const path = match[1];
  const arrow = path.indexOf(' -> ');
  const raw = arrow === -1 ? path : path.slice(arrow + 4);
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  return raw.slice(1, -1).replace(/\\(.)/g, '$1');
}

/** Branch + what is dirty inside the content surface. */
export async function publishStatus() {
  const branch = await git('branch', '--show-current');
  const paths = await trackedContentPaths();
  const porcelain = paths.length
    ? await gitRaw('status', '--porcelain', '--', ...paths)
    : '';
  const files = porcelain
    .split('\n')
    .filter(Boolean)
    .map(porcelainPath)
    .filter((file) => typeof file === 'string' && file.length > 0);
  return {
    branch,
    files,
    canPublish: branch === PUBLISH_BRANCH,
    publishBranch: PUBLISH_BRANCH,
  };
}

/**
 * Turn the save bar's change manifest into a line a human (or a model) can read.
 * The manifest is far richer than the JSON diff — a reordered `sections` array
 * is 200 lines of noise on disk but "reordered 3 sections" here.
 */
/**
 * `src/content/projects/tapico.json` → `tapico`. Used when there is no manifest
 * — publishing content that was saved earlier (often on another branch) rather
 * than in this save-bar session, so the client has nothing to describe.
 */
function documentsFromFiles(files = []) {
  const names = files
    .map((file) => /([^/\\]+)\.json$/.exec(String(file).replace(/^"|"$/g, '')))
    .filter(Boolean)
    .map((match) => match[1]);
  return [...new Set(names)];
}

function describeManifest(manifest = {}, files = []) {
  const documents = Array.isArray(manifest.documents) && manifest.documents.length
    ? manifest.documents
    : documentsFromFiles(files);
  const counts = manifest.changes && typeof manifest.changes === 'object' ? manifest.changes : {};
  const labels = {
    text: ['text field', 'text fields'],
    spacing: ['spacing change', 'spacing changes'],
    crop: ['image crop', 'image crops'],
    grid: ['image grid', 'image grids'],
    carousel: ['carousel', 'carousels'],
    caption: ['caption', 'captions'],
    mediaInsert: ['image insert', 'image inserts'],
    sectionInsert: ['new section', 'new sections'],
    sectionDelete: ['deleted section', 'deleted sections'],
    sectionOrder: ['section reorder', 'section reorders'],
    listingOrder: ['grid reorder', 'grid reorders'],
  };

  const parts = [];
  for (const [key, [singular, plural]] of Object.entries(labels)) {
    const count = Number(counts[key]) || 0;
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  }

  const where = documents.length ? documents.join(', ') : 'site content';
  const what = parts.length ? parts.join(', ') : 'content edits';
  // JSON field paths are deliberately left out — small models copy them straight
  // into the subject line ("Updated sections.12.paragraphs") instead of describing
  // the edit. The counts above carry everything the subject actually needs.
  return `${documents.length === 1 ? 'Page' : 'Pages'}: ${where}\nEdits: ${what}`;
}

function fallbackMessage(manifest, files) {
  const documents = Array.isArray(manifest?.documents) && manifest.documents.length
    ? manifest.documents
    : documentsFromFiles(files);
  const where = documents.length
    ? documents.join(', ')
    : (files.length === 1 ? files[0] : `${files.length} files`);
  const counts = manifest?.changes && typeof manifest.changes === 'object' ? manifest.changes : {};
  const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const suffix = total ? ` (${total} ${total === 1 ? 'change' : 'changes'})` : '';
  return `content: update ${where}${suffix}`;
}

/**
 * Tuned against gemma3:4b over five sample manifests. Two things are load-bearing
 * and should not be "tidied": naming the banned verb forms explicitly (without it
 * the model writes "Refines …" for every subject), and the no-invention rule.
 * Do NOT add a few-shot example — at this model size an "Example input:" block
 * makes it echo the manifest back verbatim instead of writing a subject.
 */
const SYSTEM_PROMPT = [
  'Write a git commit subject for edits made to a page on a design portfolio website.',
  'Do not repeat or reformat the input. Write one original line, under 60 characters.',
  'Begin with a plain imperative verb (Update, Revise, Retune, Reorder, Rewrite, Replace)',
  '— not "Refines" or "Updated".',
  'Use only names and facts present in the input; never invent any.',
  'Describe edits the way a designer would, never as field paths or code.',
  'No final period, no quotes.',
].join('\n');

/** Sanitize whatever the model returned down to a single usable subject line. */
function normalizeSubject(raw) {
  const first = lines(raw)[0];
  if (!first) return null;
  const stripped = first.replace(/^["'`]+|["'`.]+$/g, '').trim();
  if (!stripped) return null;
  const prefixed = stripped.startsWith('content:') ? stripped : `content: ${stripped}`;
  return prefixed.slice(0, 100);
}

/**
 * Ask the local model for a subject line. Optional by design: if Ollama is not
 * running, the model is missing, or the call is slow, publishing still happens
 * with the deterministic message. Never let the message generator block a
 * publish — a commit that lands with a plainer subject beats one that does not
 * land at all.
 */
async function generateMessage(manifest, files) {
  const fallback = fallbackMessage(manifest, files);

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
      body: JSON.stringify({
        model: MESSAGE_MODEL,
        system: SYSTEM_PROMPT,
        prompt: describeManifest(manifest, files),
        stream: false,
        options: { temperature: 0.2, num_predict: 40 },
      }),
    });
    if (!response.ok) return { message: fallback, generated: false };
    const payload = await response.json();
    return { message: normalizeSubject(payload.response) || fallback, generated: true };
  } catch {
    // Daemon down, model not pulled, or timed out — the fallback is fine.
    return { message: fallback, generated: false };
  }
}

/**
 * Commit the dirty content surface to main and push. Refuses rather than
 * guessing whenever the repo is in a state where "just the content" is unclear.
 */
export async function publishContent(manifest) {
  const status = await publishStatus();

  if (!status.canPublish) {
    return { ok: false, error: `On ${status.branch || 'a detached HEAD'} — switch to ${PUBLISH_BRANCH} to publish.` };
  }
  if (!status.files.length) {
    return { ok: false, error: 'No content changes to publish.' };
  }

  // Anything already staged outside the content surface would ride along in the
  // commit below. Refuse instead of quietly publishing someone's engine work.
  const staged = lines(await git('diff', '--cached', '--name-only'));
  const strays = staged.filter((file) => !isContentPath(file));
  if (strays.length) {
    return {
      ok: false,
      error: `Engine files are staged (${strays.slice(0, 3).join(', ')}) — commit or unstage them first.`,
    };
  }

  await git('add', '--', ...await trackedContentPaths());
  const stagedNow = lines(await git('diff', '--cached', '--name-only'));
  if (!stagedNow.length) {
    return { ok: false, error: 'No content changes to publish.' };
  }

  const { message, generated } = await generateMessage(manifest, stagedNow);
  await git('commit', '-m', message);

  try {
    await git('push', 'origin', PUBLISH_BRANCH);
  } catch (error) {
    return {
      ok: true,
      pushed: false,
      message,
      generated,
      files: stagedNow,
      error: error instanceof Error ? error.message.split('\n')[0] : 'Push failed.',
    };
  }

  return { ok: true, pushed: true, message, generated, files: stagedNow };
}

/**
 * Dev-only publish route. `apply: 'serve'` keeps it out of the static build, so
 * the live site never has it. GET reports whether publishing is available on
 * the current branch; POST commits the content surface and pushes to main.
 *
 * @returns {import('vite').Plugin}
 */
export function publishDevWriter() {
  return {
    name: 'content-publish-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/publish', async (req, res, next) => {
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method === 'GET') {
          try {
            send(200, await publishStatus());
          } catch (error) {
            send(500, { error: error instanceof Error ? error.message : 'Could not read git status.' });
          }
          return;
        }

        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const result = await publishContent(payload.manifest || {});
            send(result.ok ? 200 : 409, result);
          } catch (error) {
            send(500, { error: error instanceof Error ? error.message : 'Could not publish.' });
          }
        });
      });
    },
  };
}
