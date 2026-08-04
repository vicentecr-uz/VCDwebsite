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
/** Deliberately the cheapest model — this writes a one-line subject, nothing more. */
const MESSAGE_MODEL = 'claude-haiku-4-5';

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

/** `XY path`, or `XY old -> new` for renames. */
function porcelainPath(line) {
  const match = /^..\s(.*)$/.exec(line);
  if (!match) return null;
  const path = match[1];
  const arrow = path.indexOf(' -> ');
  return arrow === -1 ? path : path.slice(arrow + 4);
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
function describeManifest(manifest = {}) {
  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
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
  const paths = Array.isArray(manifest.textPaths) && manifest.textPaths.length
    ? `\nEdited fields: ${manifest.textPaths.slice(0, 8).join(', ')}`
    : '';

  return `Pages: ${where}\nChanges: ${what}${paths}`;
}

function fallbackMessage(manifest, files) {
  const documents = Array.isArray(manifest?.documents) ? manifest.documents : [];
  const where = documents.length
    ? documents.join(', ')
    : (files.length === 1 ? files[0] : `${files.length} files`);
  const counts = manifest?.changes && typeof manifest.changes === 'object' ? manifest.changes : {};
  const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const suffix = total ? ` (${total} ${total === 1 ? 'change' : 'changes'})` : '';
  return `content: update ${where}${suffix}`;
}

const SYSTEM_PROMPT = [
  "You write git commit subjects for edits to a designer's portfolio website.",
  'These are content edits — copy, image crops, captions, section order — not code.',
  'Reply with ONE subject line and nothing else.',
  'Rules: start with "content: ", imperative mood, at most 72 characters,',
  'no trailing period, no quotes, no explanation.',
  'Describe what changed on the page in plain language.',
].join(' ');

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
 * Ask Haiku for a subject line. Optional by design: with no API key, or if the
 * call fails for any reason, publishing still happens with the deterministic
 * message. Never let the message generator block a publish.
 */
async function generateMessage(manifest, files) {
  const fallback = fallbackMessage(manifest, files);
  if (!process.env.ANTHROPIC_API_KEY) return { message: fallback, generated: false };

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MESSAGE_MODEL,
      max_tokens: 128,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: describeManifest(manifest) }],
    });
    if (response.stop_reason === 'refusal') return { message: fallback, generated: false };
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return { message: normalizeSubject(text) || fallback, generated: true };
  } catch {
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
