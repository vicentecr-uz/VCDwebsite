// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/**
 * The content surface. Everything here publishes from the dev save bar straight
 * to main; everything else is engine work and belongs on a feature branch.
 * Keep in sync with scripts/commit-engine.sh and AGENTS.md.
 */
export const CONTENT_PATHS = ['src/content', 'media'];
const PUBLISH_BRANCH = 'main';

/**
 * Code that decides how content JSON becomes pixels. Content and the engine that
 * renders it are versioned separately — content publishes straight to main, the
 * engine travels through a branch — so a content edit that depends on unmerged
 * rendering code breaks the live site the moment it lands.
 *
 * There is no schema and no content collections to catch it: `ProjectSections`
 * dispatches on `section.type` through an `if` chain ending in `return null`, so
 * an unknown section type silently vanishes and an unknown field is silently
 * ignored. Nothing throws, nothing logs.
 *
 * The check this list feeds is deliberately **branch-level**, not field-level:
 * "does this branch touch rendering at all?", never "does this edit use a new
 * field?". A per-field check (a feature manifest, or static analysis of main's
 * renderer) fails **open** — one unregistered field or one parse miss across 16
 * components silently permits a breaking publish. This fails closed, and the
 * override exists for when it is wrong. See Atlas handoff 260804.
 *
 * A stale list also fails open, so err towards including a path.
 */
const RENDERING_PATHS = [
  'src/components/project/',
  'src/components/ProjectGrid.astro',
  'src/components/GalleryMediaInk.astro',
  'src/lib/project',
  'src/lib/projects.ts',
  'src/pages/index.astro',
  'src/pages/work.astro',
  'src/pages/play.astro',
  'src/pages/[slug].astro',
  'src/styles/project.css',
  'src/scripts/adaptiveMediaInk.ts',
  'src/scripts/bindGalleryMediaInk.ts',
  'src/scripts/bindCaptionMediaInk.ts',
  // The dev writers live here: they decide the shape of what gets written to
  // content JSON, so a change to them can produce JSON main cannot read.
  'astro.config.mjs',
  'scripts/dev-api-plugins.mjs',
  // Decides which media/ files ship to dist/images/ — rendering-adjacent.
  'scripts/collect-shipped-assets.mjs',
  'scripts/image-derivatives.mjs',
  'src/lib/images.ts',
];

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

/** Same, with extra environment — used to build a commit against a scratch index. */
const gitWithEnv = async (env, ...args) => {
  const { stdout } = await execFile('git', args, { cwd: process.cwd(), env: { ...process.env, ...env } });
  return stdout.trim();
};

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

const isRenderingPath = (file) => RENDERING_PATHS.some((prefix) => file.startsWith(prefix));

/**
 * What this checkout last published, as `path → blob sha` (null for a deletion).
 *
 * Without it the staleness guard cannot tell *our own* last publish from someone
 * else's: publish twice from the same feature branch and the second attempt sees
 * main carrying a commit to that file which the branch's merge base predates,
 * and refuses — so cross-branch publishing worked exactly once per branch.
 *
 * Local to the checkout (it lives in .git, is never committed, and never syncs)
 * because that is exactly what it describes: what *this* working tree last sent.
 */
async function publishRecordPath() {
  const gitDir = await git('rev-parse', '--absolute-git-dir');
  return path.join(gitDir, 'vcd-last-publish.json');
}

async function readPublishRecord() {
  try {
    return JSON.parse(await readFile(await publishRecordPath(), 'utf8'));
  } catch {
    // Absent or unreadable — fall back to merge-base comparison for every file.
    return {};
  }
}

async function writePublishRecord(entries) {
  try {
    const record = { ...await readPublishRecord(), ...entries };
    await writeFile(await publishRecordPath(), `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // A missing record only costs a false "main has newer edits" later, which is
    // recoverable. Never fail a publish that already landed over bookkeeping.
  }
}

/** Blob sha of `file` at `ref`, or null when it does not exist there. */
async function blobAt(ref, file) {
  try {
    return await git('rev-parse', `${ref}:${file}`);
  } catch {
    return null;
  }
}

/**
 * Files whose version on main did not come from us and is not what our branch
 * started from — publishing those would silently revert whoever wrote them.
 *
 * A file matching our last-published blob is safe no matter how far main has
 * moved: we put that version there, and nothing has changed it since.
 */
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

/** Porcelain lines → paths, dropping anything git quoted or we could not parse. */
const porcelainPaths = (raw) => raw
  .split('\n')
  .filter(Boolean)
  .map(porcelainPath)
  .filter((file) => typeof file === 'string' && file.length > 0);

/**
 * The ref to compare against — the tip of the publish branch as this checkout
 * last saw it. Deliberately not fetched here: publishStatus() is polled by the
 * save bar on every dev-mode entry, and a network round trip per poll is not
 * worth it. Publish itself fetches before it commits.
 */
async function publishBaseRef() {
  for (const ref of [`origin/${PUBLISH_BRANCH}`, PUBLISH_BRANCH]) {
    try {
      await execFile('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: process.cwd() });
      return ref;
    } catch {
      // Not present in this checkout — try the next one.
    }
  }
  return null;
}

/**
 * Rendering code that differs from the publish branch: committed on this branch
 * since it diverged, plus anything dirty in the working tree. Both matter — a
 * content edit can depend on either, and neither travels with a content publish.
 *
 * On main with a clean tree this is empty, so the everyday flow is unchanged.
 */
export async function renderingChanges() {
  const base = await publishBaseRef();
  const changed = new Set();

  if (base) {
    // Three-dot: what this branch changed since the merge base, ignoring what
    // moved on main. Commits on main are not this branch's problem.
    for (const file of lines(await git('diff', '--name-only', `${base}...HEAD`))) {
      changed.add(file);
    }
  }
  for (const file of porcelainPaths(await gitRaw('status', '--porcelain'))) {
    changed.add(file);
  }

  return [...changed].filter(isRenderingPath).sort();
}

/**
 * Content in this working tree that differs from the publish branch — the real
 * definition of "unpublished". Not the same as "dirty": content committed on a
 * feature branch is still unpublished, and content published from here off-branch
 * stops counting the moment it lands on main, even though it stays dirty against
 * the feature branch until that branch merges.
 *
 * Returns `{ files, behind }` — see splitAheadBehind() for why the difference
 * between the two matters.
 */
async function unpublishedContent() {
  const paths = await trackedContentPaths();
  const base = await publishBaseRef();

  if (!base) {
    // No main to compare against (a fresh clone of a branch, say) — fall back to
    // plain dirtiness, which is what this reported before cross-branch publish.
    return {
      files: paths.length ? porcelainPaths(await gitRaw('status', '--porcelain', '--', ...paths)) : [],
      behind: [],
    };
  }

  const changed = new Set();
  if (paths.length) {
    for (const file of lines(await git('diff', '--name-only', base, '--', ...paths))) {
      changed.add(file);
    }
    for (const file of lines(await git('ls-files', '--others', '--exclude-standard', '--', ...paths))) {
      changed.add(file);
    }
  }
  // Untracked content under a directory git does not track at all yet — the
  // pathspec above would have errored on it, so ask without one.
  for (const file of lines(await git('ls-files', '--others', '--exclude-standard'))) {
    if (isContentPath(file)) changed.add(file);
  }

  return splitAheadBehind([...changed].sort(), base);
}

/**
 * "Differs from main" is two different situations and only one is publishable.
 *
 * If our copy is still exactly what we last put on main (or what this branch
 * started from), we have not edited it — **main moved and we are behind**.
 * Counting that as unpublished is a lie in the direction that matters: it invites
 * a publish that would revert whoever moved main.
 *
 * Only a file we have actually changed since we last synced is ahead.
 */
async function splitAheadBehind(files, target) {
  if (!files.length) return { files: [], behind: [] };

  const record = await readPublishRecord();
  let mergeBase = null;
  try {
    mergeBase = await git('merge-base', 'HEAD', target);
  } catch {
    // No shared history — every difference reads as ours, which is the safe way
    // round: the staleness guard still refuses anything main changed under us.
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

/** Branch, what is unpublished inside the content surface, and whether it is safe to publish. */
export async function publishStatus() {
  const branch = await git('branch', '--show-current');
  const { files, behind } = await unpublishedContent();
  const renderingFiles = await renderingChanges();

  return {
    branch,
    files,
    behind,
    // Publishing is no longer gated on being on main — content commits to main
    // through a worktree from wherever you are. What it is gated on is whether
    // this branch could have produced content main cannot render.
    canPublish: renderingFiles.length === 0,
    onPublishBranch: branch === PUBLISH_BRANCH,
    rendersContent: renderingFiles.length > 0,
    renderingFiles,
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
    layout: ['Intro height change', 'Intro height changes'],
    crop: ['image crop', 'image crops'],
    grid: ['image grid', 'image grids'],
    carousel: ['carousel', 'carousels'],
    caption: ['caption', 'captions'],
    mediaInsert: ['image insert', 'image inserts'],
    mediaRemove: ['removed image', 'removed images'],
    sectionInsert: ['new section', 'new sections'],
    sectionDelete: ['deleted section', 'deleted sections'],
    sectionOrder: ['section reorder', 'section reorders'],
    listingOrder: ['grid reorder', 'grid reorders'],
    galleryMembership: ['gallery page', 'gallery pages'],
    sectionNav: ['outline change', 'outline changes'],
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
 * Publish while standing on main: stage the content surface and commit in place,
 * exactly as before cross-branch publishing existed. Kept as its own path rather
 * than folded into the off-branch one because it is the only case where moving
 * the branch ref and leaving a clean tree is what you actually want.
 */
async function publishInPlace(manifest) {
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

  // Recorded here too, so a later publish from a feature branch knows these
  // versions of main came from this checkout rather than from someone else.
  await writePublishRecord(
    Object.fromEntries(await Promise.all(stagedNow.map(async (file) => [file, await blobAt('HEAD', file)]))),
  );

  return { ok: true, pushed: true, message, generated, files: stagedNow };
}

/**
 * Publish from a feature branch, without switching to main.
 *
 * Builds the commit with plumbing against a scratch index: seed a tree from
 * origin/main, swap in this working tree's content blobs, write the tree, commit
 * it onto origin/main, push. The working checkout, its index, and the current
 * branch are never touched — no files move under the dev server, and no engine
 * work in progress can be swept in, because nothing is ever staged.
 *
 * (The handoff proposed a worktree pinned to main for this. Plumbing gets the
 * same property — commit to main from wherever you are — with no second checkout
 * to create, clean up, or keep in sync, so there is no worktree lifecycle to get
 * wrong. The trade is that this path is lower-level and has to be tested against
 * a real repo; see scripts/test/publish-cross-branch.test.mjs.)
 *
 * Content stays dirty against the feature branch afterwards. That resolves
 * itself when the branch merges or rebases, and publishStatus() already stops
 * counting it as unpublished because it compares against main, not the branch.
 */
async function publishFromBranch(manifest, files) {
  // Everything below reasons about origin/main, so it has to be current.
  try {
    await git('fetch', 'origin', PUBLISH_BRANCH);
  } catch {
    return { ok: false, error: `Could not reach origin to publish to ${PUBLISH_BRANCH}.` };
  }

  const target = `origin/${PUBLISH_BRANCH}`;
  const mergeBase = await git('merge-base', 'HEAD', target);

  // Guard: only refuse when main's copy of a file came from somewhere that is
  // neither us nor this branch's starting point. Republishing a file we already
  // published from here is the normal case, not a conflict.
  const stale = await staleFiles(files, target, mergeBase);
  if (stale.length) {
    return {
      ok: false,
      error: `${PUBLISH_BRANCH} has newer edits to ${stale.slice(0, 3).join(', ')} — merge or rebase onto ${PUBLISH_BRANCH} first.`,
    };
  }

  const scratchIndex = path.join(os.tmpdir(), `vcd-publish-index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: scratchIndex };

  try {
    await gitWithEnv(env, 'read-tree', target);

    const published = {};
    for (const file of files) {
      const absolute = path.join(process.cwd(), file);
      if (existsSync(absolute)) {
        const blob = await gitWithEnv(env, 'hash-object', '-w', '--', absolute);
        // Content is JSON and images — never executable, never a symlink.
        await gitWithEnv(env, 'update-index', '--add', '--cacheinfo', `100644,${blob},${file}`);
        published[file] = blob;
      } else {
        // Deleted locally: publish the deletion rather than skipping the file.
        await gitWithEnv(env, 'update-index', '--force-remove', '--', file);
        published[file] = null;
      }
    }

    const tree = await gitWithEnv(env, 'write-tree');
    if (tree === await git('rev-parse', `${target}^{tree}`)) {
      return { ok: false, error: 'No content changes to publish.' };
    }

    const { message, generated } = await generateMessage(manifest, files);
    const commit = await gitWithEnv(env, 'commit-tree', tree, '-p', target, '-m', message);

    try {
      // Rejected if main moved between the fetch above and now — which is the
      // correct outcome, and why this pushes the bare commit rather than a ref.
      await git('push', 'origin', `${commit}:refs/heads/${PUBLISH_BRANCH}`);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message.split('\n').pop() || 'Push failed.' : 'Push failed.',
      };
    }

    // Only after the push lands: this records what main now holds because of us.
    await writePublishRecord(published);

    return { ok: true, pushed: true, message, generated, files, branch: await git('branch', '--show-current') };
  } finally {
    await rm(scratchIndex, { force: true });
  }
}

/**
 * Throw away unpublished content edits: restore each ahead content-surface path
 * to the publish branch tip (`origin/main` / `main`). Engine files are untouched.
 *
 * Untracked content that never existed on main is deleted. Tracked paths are
 * checked out from the publish base. Used by the save-bar Revert when there is
 * nothing in-memory left to undo (#196).
 */
export async function revertUnpublishedContent() {
  // Match publish: reason about a current tip, not a stale fetch.
  try {
    await git('fetch', 'origin', PUBLISH_BRANCH);
  } catch {
    // Offline / no origin — fall through to whatever publishBaseRef resolves.
  }

  const base = await publishBaseRef();
  if (!base) {
    return { ok: false, error: 'No main ref to restore from.' };
  }

  const { files } = await unpublishedContent();
  if (!files.length) {
    return { ok: false, error: 'No unpublished content to revert.' };
  }

  const restored = [];
  /** @type {Record<string, string | null>} */
  const recordUpdates = {};

  for (const file of files) {
    if (!isContentPath(file)) {
      return { ok: false, error: `Refusing to revert non-content path: ${file}` };
    }
    const absolute = path.join(process.cwd(), file);
    const onBase = await blobAt(base, file);
    if (onBase) {
      await git('checkout', base, '--', file);
      restored.push(file);
      recordUpdates[file] = existsSync(absolute)
        ? await git('hash-object', '--', absolute)
        : onBase;
    } else if (existsSync(absolute)) {
      // Absent from main is not the same as unpublished. A file committed on
      // this branch is branch work that main has simply not seen yet, and
      // deleting it throws away a commit rather than an edit. An entire
      // branch-new content directory looks exactly like this from main's side
      // — media/ before #211 lands is 289 files that all pass the old test —
      // so restore the committed version and leave the publish record alone.
      const onHead = await blobAt('HEAD', file);
      if (onHead) {
        await git('checkout', 'HEAD', '--', file);
        restored.push(file);
        continue;
      }
      await rm(absolute, { force: true });
      restored.push(file);
      recordUpdates[file] = null;
    }
  }

  await writePublishRecord(recordUpdates);
  return { ok: true, restored };
}

/**
 * Commit the unpublished content surface to main and push. Refuses rather than
 * guessing whenever the repo is in a state where "just the content" is unclear.
 *
 * `force` overrides the rendering-code gate — see publishDevWriter().
 */
export async function publishContent(manifest, { force = false } = {}) {
  const status = await publishStatus();

  if (!status.branch) {
    return { ok: false, error: 'On a detached HEAD — check out a branch to publish.' };
  }
  if (!status.files.length) {
    return { ok: false, error: 'No content changes to publish.' };
  }
  if (status.rendersContent && !force) {
    return {
      ok: false,
      needsOverride: true,
      renderingFiles: status.renderingFiles,
      error: `This branch changes how content renders (${status.renderingFiles.slice(0, 3).join(', ')}).`,
    };
  }

  return status.onPublishBranch
    ? publishInPlace(manifest)
    : publishFromBranch(manifest, status.files);
}

/**
 * Dev-only publish route. `apply: 'serve'` keeps it out of the static build, so
 * the live site never has it. GET reports whether publishing is available on
 * the current branch; POST commits the content surface and pushes to main.
 * `/api/content-revert` restores unpublished content to the publish branch tip.
 *
 * @returns {import('vite').Plugin}
 */
export function publishDevWriter() {
  return {
    name: 'content-publish-dev-writer',
    apply: 'serve',
    configureServer(server) {
      const sendJson = (res, status, payload) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
      };

      server.middlewares.use('/api/content-revert', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        try {
          const result = await revertUnpublishedContent();
          sendJson(res, result.ok ? 200 : 409, result);
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : 'Could not revert unpublished content.',
          });
        }
      });

      server.middlewares.use('/api/publish', async (req, res, next) => {
        if (req.method === 'GET') {
          try {
            sendJson(res, 200, await publishStatus());
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : 'Could not read git status.',
            });
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
            // `force` is Anto clicking through the rendering-code warning. The
            // branch-level check is deliberately coarse — he knows whether he
            // just used a new toggle, the check cannot.
            const result = await publishContent(payload.manifest || {}, {
              force: payload.force === true,
            });
            sendJson(res, result.ok ? 200 : 409, result);
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : 'Could not publish.',
            });
          }
        });
      });
    },
  };
}
