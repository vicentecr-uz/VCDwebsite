// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual, promisify } from 'node:util';
import { requestVpsAgent } from './vps-agent.mjs';
import { contentGitArgs, hasContentRepository, isReviewPreview } from './content-repository.mjs';

const execFile = promisify(execFileCb);

// known limit: issue #277
export const CONTENT_PATHS = ['src/content', 'media'];
const PUBLISH_BRANCH = 'main';

const separateContentRepository = () => hasContentRepository(process.cwd());
const contentGitOptions = () => contentGitArgs(process.cwd());

const RENDERING_PATHS = [
  'src/lib/craftDemos.ts',
  'src/lib/demoIndicatorLayer.ts',
  'src/lib/demoCursorGlyphs.ts',
  'src/styles/demoIndicators.css',
  'src/styles/demoFinger.css',
  'src/lib/sabi/',
  'src/lib/stageshow/',
  'src/pages/preview/[sabi].astro',
  'src/components/project/',
  'src/scripts/siteAnnotationPosition.ts',
  'src/lib/siteAnnotations.ts',
  'src/lib/siteAnnotationSvg.ts',
  'src/styles/site-annotations.css',
  'scripts/dev-annotations.mjs',
  'src/lib/devTextDom.ts',
  'src/lib/devInlineMarks.ts',
  'src/layouts/DocumentationLayout.astro',
  'src/components/DocumentationContents.astro',
  'src/components/DocumentationNavigation.astro',
  'src/pages/sabi/',
  'src/components/ProjectGrid.astro',
  'src/components/GalleryMediaInk.astro',
  'src/lib/project',
  'src/lib/projects.ts',
  'src/components/Header.astro',
  'src/pages/index.astro',
  'src/components/home/HomeIntroController.astro',
  'src/scripts/homeIntro.ts',
  'src/pages/play.astro',
  'src/pages/sabi.astro',
  'src/layouts/HeroLayout.astro',
  'src/pages/digital.astro',
  'src/pages/about.astro',
  'src/pages/[slug].astro',
  'src/styles/project.css',
  'src/scripts/adaptiveMediaInk.ts',
  'src/scripts/bindGalleryMediaInk.ts',
  'src/scripts/bindCaptionMediaInk.ts',
  'astro.config.mjs',
  'scripts/dev-api-plugins.mjs',
  'scripts/collect-shipped-assets.mjs',
  'scripts/public-site-output.mjs',
  'scripts/image-derivatives.mjs',
  'src/lib/images.ts',
  'src/lib/normalizeHref.mjs',
  'public/awards/',
  'src/lib/imageUpload.mjs',
  'src/lib/inlineVideo.ts',
  'src/lib/content-schema.ts',
];

const MESSAGE_TIMEOUT_MS = 20_000;

const gitRaw = async (...args) => {
  const { stdout } = await execFile('git', args, { cwd: process.cwd() });
  return stdout;
};

const git = async (...args) => (await gitRaw(...args)).trim();

const contentGitRaw = async (...args) => {
  const { stdout } = await execFile('git', [...contentGitOptions(), ...args], { cwd: process.cwd() });
  return stdout;
};

const contentGit = async (...args) => (await contentGitRaw(...args)).trim();

const gitWithEnv = async (env, ...args) => {
  const { stdout } = await execFile('git', args, { cwd: process.cwd(), env: { ...process.env, ...env } });
  return stdout.trim();
};

const contentGitWithEnv = async (env, ...args) => {
  const { stdout } = await execFile('git', [...contentGitOptions(), ...args], { cwd: process.cwd(), env: { ...process.env, ...env } });
  return stdout.trim();
};

const lines = (value) => value.split('\n').map((line) => line.trim()).filter(Boolean);

const nullPaths = (value) => value.split('\0').filter(Boolean);

const isContentPath = (file) => CONTENT_PATHS.some((dir) => file.startsWith(`${dir}/`));

async function trackedContentPaths() {
  const present = [];
  for (const dir of CONTENT_PATHS) {
    try {
      await execFile('git', [...contentGitOptions(), 'ls-files', '--error-unmatch', '--', dir], { cwd: process.cwd() });
      present.push(dir);
    } catch {
    }
  }
  return present;
}

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

async function publishRecordPath() {
  const gitDir = await contentGit('rev-parse', '--absolute-git-dir');
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
  }
}

async function blobAt(ref, file) {
  try {
    return await contentGit('rev-parse', `${ref}:${file}`);
  } catch {
    return null;
  }
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

const porcelainPaths = (raw) => raw
  .split('\n')
  .filter(Boolean)
  .map(porcelainPath)
  .filter((file) => typeof file === 'string' && file.length > 0);

async function publishBaseRef(content = separateContentRepository()) {
  const run = content ? contentGit : git;
  for (const ref of [`origin/${PUBLISH_BRANCH}`, PUBLISH_BRANCH]) {
    try {
      await run('rev-parse', '--verify', '--quiet', ref);
      return ref;
    } catch {
    }
  }
  return null;
}

export async function renderingChanges() {
  const base = await publishBaseRef(false);
  const changed = new Set();

  if (base) {
    for (const file of lines(await git('diff', '--name-only', `${base}...HEAD`))) {
      changed.add(file);
    }
  }
  for (const file of porcelainPaths(await gitRaw('status', '--porcelain'))) {
    changed.add(file);
  }

  return [...changed].filter(isRenderingPath).sort();
}

async function unpublishedContent() {
  const ref = await publishBaseRef(true);
  if (!ref) {
    return {
      files: porcelainPaths(await contentGitRaw('status', '--porcelain', '--', ...CONTENT_PATHS)),
      behind: [],
      base: null,
    };
  }
  const base = await contentGit('rev-parse', ref);
  const changed = new Set(nullPaths(await contentGitRaw('diff', '--name-only', '-z', base, '--', ...CONTENT_PATHS)));
  const excludes = separateContentRepository() ? [] : ['--exclude-standard'];
  for (const file of nullPaths(await contentGitRaw('ls-files', '--others', ...excludes, '-z', '--', ...CONTENT_PATHS))) changed.add(file);
  return { ...await splitAheadBehind([...changed].sort(), base), base };
}

async function splitAheadBehind(files, target) {
  if (!files.length) return { files: [], behind: [] };

  const record = await readPublishRecord();
  let mergeBase = null;
  try {
    mergeBase = await contentGit('merge-base', 'HEAD', target);
  } catch {
  }

  const ahead = [];
  const behind = [];
  for (const file of files) {
    const absolute = path.join(process.cwd(), file);
    const ours = existsSync(absolute) ? await contentGit('hash-object', '--', absolute) : null;
    const lastSynced = Object.hasOwn(record, file)
      ? record[file]
      : (mergeBase ? await blobAt(mergeBase, file) : null);
    (ours === lastSynced ? behind : ahead).push(file);
  }
  return { files: ahead, behind };
}

async function unpublishedDetails(base, file) {
  if (!base || !file.startsWith('src/content/') || !file.endsWith('.json')) return [];
  try {
    const [published, saved] = await Promise.all([
      contentGitRaw('show', `${base}:${file}`).then(JSON.parse),
      readFile(path.join(process.cwd(), file), 'utf8').then(JSON.parse),
    ]);
    const changedKeys = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => !isDeepStrictEqual(before[key], after[key]));
    const details = changedKeys(published, saved).filter((key) => key !== 'sections');
    const before = published.sections ?? [];
    const after = saved.sections ?? [];
    if (isDeepStrictEqual(before, after)) return details;
    const sectionKey = (section) => section.id || section.sectionId;
    const oldKeys = before.map(sectionKey);
    const newKeys = after.map(sectionKey);
    // known limit: issue #275
    const stableKeys = (keys) => keys.every(Boolean) && new Set(keys).size === keys.length;
    if (!stableKeys(oldKeys) || !stableKeys(newKeys)) {
      const moved = before.some((section, index) => !isDeepStrictEqual(section, after[index])
        && after.some((other, position) => position !== index && isDeepStrictEqual(section, other)));
      if (moved || before.length !== after.length || before.some((section, index) =>
        section.type !== after[index].type || oldKeys[index] !== newKeys[index])) {
        return [...details, 'Section layout'];
      }
      after.forEach((section, index) => {
        for (const field of changedKeys(before[index], section)) {
          details.push(`Block ${index + 1} · ${field}`);
        }
      });
      return details;
    }
    const sectionLabel = (section, key, index) => (
      typeof section.title === 'string' && section.title
        ? section.title
        : /-[a-z0-9]{7,}$/.test(key) ? `Block ${index + 1}` : key
    );
    const oldSections = new Map(oldKeys.map((key, index) => [key, before[index]]));
    const newSections = new Map(newKeys.map((key, index) => [key, after[index]]));
    for (const [index, key] of newKeys.entries()) {
      const section = after[index];
      const previous = oldSections.get(key);
      const label = sectionLabel(section, key, index);
      if (!previous) details.push(`${label} · Added`);
      else for (const field of changedKeys(previous, section)) details.push(`${label} · ${field}`);
    }
    oldKeys.forEach((key, index) => {
      if (!newSections.has(key)) details.push(`${sectionLabel(before[index], key, index)} · Removed`);
    });
    if (!isDeepStrictEqual(oldKeys.filter((key) => newSections.has(key)),
      newKeys.filter((key) => oldSections.has(key)))) details.push('Section order');
    return details;
  } catch {
    return [];
  }
}

export async function publishStatus({ includeDetails = false } = {}) {
  const branch = await git('branch', '--show-current');
  const reviewPreview = isReviewPreview(process.cwd());
  if (reviewPreview) {
    return {
      branch,
      files: [],
      behind: [],
      canPublish: false,
      readOnly: true,
      onPublishBranch: false,
      contentBranch: null,
      rendersContent: false,
      renderingFiles: [],
      publishBranch: PUBLISH_BRANCH,
    };
  }
  const contentBranch = separateContentRepository() ? await contentGit('branch', '--show-current') : branch;
  const { files, behind, base } = await unpublishedContent();
  const renderingFiles = await renderingChanges();

  return {
    branch,
    files,
    behind,
    ...(includeDetails ? {
      details: Object.fromEntries(await Promise.all(files.map(async (file) =>
        [file, await unpublishedDetails(base, file)]))),
    } : {}),
    canPublish: !reviewPreview && renderingFiles.length === 0
      && (!separateContentRepository() || contentBranch === PUBLISH_BRANCH),
    readOnly: reviewPreview,
    onPublishBranch: branch === PUBLISH_BRANCH,
    contentBranch,
    rendersContent: renderingFiles.length > 0,
    renderingFiles,
    publishBranch: PUBLISH_BRANCH,
  };
}

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

function normalizeSubject(raw) {
  const first = lines(raw)[0];
  if (!first) return null;
  const stripped = first.replace(/^["'`]+|["'`.]+$/g, '').trim();
  if (!stripped) return null;
  const prefixed = stripped.startsWith('content:') ? stripped : `content: ${stripped}`;
  return prefixed.slice(0, 100);
}

export async function generateMessage(manifest, files, env = {}, base = 'HEAD') {
  const fallback = fallbackMessage(manifest, files);

  try {
    const diff = (await (separateContentRepository() ? contentGitWithEnv : gitWithEnv)(
      env,
      'diff', '--cached', '--no-ext-diff', '--no-textconv', base, '--', ...CONTENT_PATHS,
    )).slice(0, 24_000);
    const payload = await requestVpsAgent({
      task: 'subject',
      summary: describeManifest(manifest, files),
      diff,
    }, { timeout: MESSAGE_TIMEOUT_MS });
    const message = normalizeSubject(payload?.subject);
    return message ? { message, generated: true } : { message: fallback, generated: false };
  } catch {
    return { message: fallback, generated: false };
  }
}

async function publishInPlace(manifest) {
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

  await writePublishRecord(
    Object.fromEntries(await Promise.all(stagedNow.map(async (file) => [file, await blobAt('HEAD', file)]))),
  );

  return { ok: true, pushed: true, message, generated, files: stagedNow };
}

async function publishSeparateContent(manifest) {
  if ((await contentGit('branch', '--show-current')) !== PUBLISH_BRANCH) {
    return { ok: false, error: `Content repository must be on ${PUBLISH_BRANCH} to publish.` };
  }

  const staged = nullPaths(await contentGitRaw('diff', '--cached', '--name-only', '-z'));
  const strays = staged.filter((file) => !isContentPath(file));
  if (strays.length) {
    return { ok: false, error: `Non-content files are staged (${strays.slice(0, 3).join(', ')}) — commit or unstage them first.` };
  }

  try {
    await contentGit('fetch', 'origin', PUBLISH_BRANCH);
  } catch {
    return { ok: false, error: `Could not reach content origin to publish to ${PUBLISH_BRANCH}.` };
  }
  const { files } = await unpublishedContent();
  const target = `origin/${PUBLISH_BRANCH}`;
  const remote = await contentGit('rev-parse', target);
  const mergeBase = await contentGit('merge-base', 'HEAD', target);
  const stale = await staleFiles(files, target, mergeBase);
  if (stale.length) {
    return { ok: false, error: `${PUBLISH_BRANCH} has newer edits to ${stale.slice(0, 3).join(', ')} — Update before publishing.` };
  }
  if (mergeBase !== remote) {
    return { ok: false, error: `Content ${PUBLISH_BRANCH} is behind or diverged from origin — Update before publishing.` };
  }
  const committedPaths = nullPaths(await contentGitRaw('diff', '--name-only', '-z', `${target}..HEAD`));
  const committedHistoryPaths = nullPaths(await contentGitRaw('log', '--format=', '--name-only', '-z', `${target}..HEAD`));
  if (committedHistoryPaths.some((file) => !isContentPath(file))) {
    return { ok: false, error: 'Unpublished content commit contains non-content files — split it before publishing.' };
  }
  const workingFiles = files.filter(isContentPath);
  for (const file of workingFiles) {
    try {
      if (!lstatSync(path.join(process.cwd(), file)).isFile()) return { ok: false, error: `Content must be a regular file: ${file}` };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (workingFiles.length) {
    await contentGit('add', '-f', '--', ...workingFiles);
  }
  const stagedNow = nullPaths(await contentGitRaw('diff', '--cached', '--name-only', '-z'));
  if (!stagedNow.length && !committedPaths.length) return { ok: false, error: 'No content changes to publish.' };

  let message;
  let generated = false;
  if (stagedNow.length) {
    ({ message, generated } = await generateMessage(manifest, stagedNow));
    await contentGit('commit', '-m', message);
  }
  try {
    await contentGit('push', 'origin', PUBLISH_BRANCH);
  } catch (error) {
    return { ok: true, pushed: false, message, generated, files: stagedNow.length ? stagedNow : committedPaths,
      error: error instanceof Error ? error.message.split('\n')[0] : 'Push failed.' };
  }

  const published = [...new Set([...committedPaths, ...stagedNow])];
  await writePublishRecord(Object.fromEntries(await Promise.all(
    published.map(async (file) => [file, await blobAt('HEAD', file)]),
  )));
  return { ok: true, pushed: true, message, generated, files: published, branch: await git('branch', '--show-current') };
}

async function publishFromBranch(manifest, files) {
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

  const scratchIndex = path.join(os.tmpdir(), `vcd-publish-index-${randomUUID()}`);
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
      return { ok: false, error: 'No content changes to publish.' };
    }

    const { message, generated } = await generateMessage(manifest, files, env, target);
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

    return { ok: true, pushed: true, message, generated, files, branch: await git('branch', '--show-current') };
  } finally {
    await rm(scratchIndex, { force: true });
  }
}

export async function revertUnpublishedContent() {
  if (isReviewPreview(process.cwd())) {
    return { ok: false, error: 'Revert is disabled in review preview mode.' };
  }
  if (separateContentRepository()) return revertSeparateContent();
  try {
    await git('fetch', 'origin', PUBLISH_BRANCH);
  } catch {
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
  let mergeBase = null;
  try {
    mergeBase = await git('merge-base', 'HEAD', base);
  } catch {
  }

  for (const file of files) {
    if (!isContentPath(file)) {
      return { ok: false, error: `Refusing to revert non-content path: ${file}` };
    }
    const absolute = path.join(process.cwd(), file);
    const onBase = await blobAt(base, file);
    const onHead = await blobAt('HEAD', file);
    const onBranchBase = mergeBase ? await blobAt(mergeBase, file) : onBase;

    if (onHead !== onBranchBase) {
      const ours = existsSync(absolute) ? await git('hash-object', '--', absolute) : null;
      if (ours === onHead) continue;
      if (onHead) {
        await git('checkout', 'HEAD', '--', file);
      } else if (existsSync(absolute)) {
        await rm(absolute, { force: true });
      }
      restored.push(file);
      continue;
    }

    if (onBase) {
      await git('checkout', base, '--', file);
      restored.push(file);
      recordUpdates[file] = existsSync(absolute)
        ? await git('hash-object', '--', absolute)
        : onBase;
    } else if (existsSync(absolute)) {
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

async function revertSeparateContent() {
  try { await contentGit('fetch', 'origin', PUBLISH_BRANCH); } catch {}
  const base = await publishBaseRef(true);
  if (!base) return { ok: false, error: 'No main ref to restore from.' };
  const { files } = await unpublishedContent();
  if (!files.length) return { ok: false, error: 'No unpublished content to revert.' };
  const mergeBase = await contentGit('merge-base', 'HEAD', base);
  const restored = [];
  const published = {};
  for (const file of files) {
    if (!isContentPath(file)) return { ok: false, error: `Refusing to revert non-content path: ${file}` };
    const onHead = await blobAt('HEAD', file);
    const locallyCommitted = onHead !== await blobAt(mergeBase, file);
    const ref = locallyCommitted ? 'HEAD' : base;
    const blob = await blobAt(ref, file);
    if (blob) await contentGit('checkout', ref, '--', file);
    else {
      await contentGit('rm', '-f', '--ignore-unmatch', '--', file);
      await rm(path.join(process.cwd(), file), { force: true });
    }
    if (!locallyCommitted) published[file] = blob;
    restored.push(file);
  }
  await writePublishRecord(published);
  return { ok: true, restored };
}

export async function publishContent(manifest, { force = false } = {}) {
  const status = await publishStatus();

  if (status.readOnly) return { ok: false, error: 'Publishing is disabled in review preview mode.' };

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

  if (separateContentRepository()) return publishSeparateContent(manifest);
  return status.onPublishBranch ? publishInPlace(manifest) : publishFromBranch(manifest, status.files);
}

/** @returns {import('vite').Plugin} */
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
            sendJson(res, 200, await publishStatus({ includeDetails: true }));
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
