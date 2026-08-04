// @ts-check
/**
 * Runs the real publish module against throwaway repos.
 *
 * `bun scripts/test/publish-cross-branch.test.mjs`
 *
 * The off-branch publish path builds commits with git plumbing against a scratch
 * index, which is not something you want to find out is subtly wrong by watching
 * it land on the live site. Every case below sets up an origin + clone, dirties
 * the content surface, and calls the exported functions with `cwd` pointed at
 * the clone — the same pattern that caught the porcelain-trim and empty-pathspec
 * bugs in the original boundary work.
 */
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const { publishContent, publishStatus, renderingChanges } = await import('../dev-publish.mjs');

let failures = 0;
let current = '';

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/** A bare origin plus a clone of it, with one content file and one engine file. */
async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-publish-test-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');

  await execFile('git', ['init', '--bare', '-b', 'main', origin]);
  await execFile('git', ['clone', origin, work]);

  const git = (...args) => execFile('git', args, { cwd: work });
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Publish Test');

  await mkdir(path.join(work, 'src/content/projects'), { recursive: true });
  await mkdir(path.join(work, 'src/components/project'), { recursive: true });
  await writeFile(path.join(work, 'src/content/projects/tapico.json'), '{"title":"Tapico"}\n');
  await writeFile(path.join(work, 'src/components/project/ProjectImage.astro'), '<img />\n');
  await writeFile(path.join(work, 'README.md'), 'engine\n');
  await git('add', '.');
  await git('commit', '-m', 'initial');
  await git('push', 'origin', 'main');

  return { root, origin, work, git };
}

/** Run `fn` with the process cwd inside the throwaway clone. */
async function inRepo(label, fn) {
  current = label;
  console.log(`\n${label}`);
  const repo = await makeRepo();
  const previous = process.cwd();
  process.chdir(repo.work);
  try {
    await fn(repo);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ threw — ${error instanceof Error ? error.message : error}`);
  } finally {
    process.chdir(previous);
    await rm(repo.root, { recursive: true, force: true });
  }
}

const contentOnOrigin = async (repo, file = 'src/content/projects/tapico.json') => {
  const { stdout } = await execFile('git', ['show', `main:${file}`], { cwd: repo.origin });
  return stdout;
};

const originHasFile = async (repo, file) => {
  try {
    await execFile('git', ['cat-file', '-e', `main:${file}`], { cwd: repo.origin });
    return true;
  } catch {
    return false;
  }
};

await inRepo('on main, clean tree → nothing to publish', async () => {
  const status = await publishStatus();
  check('no unpublished files', status.files.length === 0, status.files.join(', '));
  check('canPublish', status.canPublish === true);
  check('onPublishBranch', status.onPublishBranch === true);
  const result = await publishContent({});
  check('refuses with nothing to publish', result.ok === false && /No content changes/.test(result.error));
});

await inRepo('on main, dirty content → commits in place and pushes', async (repo) => {
  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Tapico edited"}\n');

  const status = await publishStatus();
  check('sees the unpublished file', status.files.includes('src/content/projects/tapico.json'), status.files.join(', '));

  const result = await publishContent({});
  check('published', result.ok === true && result.pushed === true, result.error);
  check('origin has the edit', (await contentOnOrigin(repo)).includes('Tapico edited'));

  const { stdout } = await repo.git('status', '--porcelain');
  check('working tree is clean afterwards', stdout.trim() === '', stdout.trim());
  check('nothing left unpublished', (await publishStatus()).files.length === 0);
});

await inRepo('on main, staged engine file → refuses rather than sweeping it in', async (repo) => {
  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Tapico edited"}\n');
  await writeFile(path.join(repo.work, 'README.md'), 'engine edited\n');
  await repo.git('add', 'README.md');

  const result = await publishContent({});
  check('refused', result.ok === false && /Engine files are staged/.test(result.error), result.error);
  check('origin unchanged', !(await contentOnOrigin(repo)).includes('edited'));
});

await inRepo('feature branch, no rendering changes → publishes to main, checkout untouched', async (repo) => {
  await repo.git('switch', '-c', 'feat/copy-tweak');
  await writeFile(path.join(repo.work, 'README.md'), 'engine edited\n');
  await repo.git('commit', '-am', 'engine: tweak readme');
  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Tapico from branch"}\n');

  const status = await publishStatus();
  check('canPublish off main', status.canPublish === true, status.renderingFiles.join(', '));
  check('not on publish branch', status.onPublishBranch === false);
  check('sees the unpublished file', status.files.includes('src/content/projects/tapico.json'));

  const headBefore = (await repo.git('rev-parse', 'HEAD')).stdout.trim();
  const result = await publishContent({});
  check('published', result.ok === true && result.pushed === true, result.error);
  check('origin main has the edit', (await contentOnOrigin(repo)).includes('Tapico from branch'));

  const headAfter = (await repo.git('rev-parse', 'HEAD')).stdout.trim();
  check('branch HEAD did not move', headBefore === headAfter);
  check('still on the feature branch', (await repo.git('branch', '--show-current')).stdout.trim() === 'feat/copy-tweak');
  check(
    'working file keeps the edit',
    (await readFile(path.join(repo.work, 'src/content/projects/tapico.json'), 'utf8')).includes('Tapico from branch'),
  );
  const { stdout: staged } = await repo.git('diff', '--cached', '--name-only');
  check('nothing was staged', staged.trim() === '', staged.trim());
  check('nothing left unpublished', (await publishStatus()).files.length === 0);
  check('engine commit did not travel to main', !(await originHasFile(repo, 'README.md')) || !(await execFile('git', ['show', 'main:README.md'], { cwd: repo.origin })).stdout.includes('engine edited'));
});

await inRepo('feature branch touching rendering code → blocked, override publishes', async (repo) => {
  await repo.git('switch', '-c', 'feat/carousel-width');
  await writeFile(path.join(repo.work, 'src/components/project/ProjectImage.astro'), '<img class="wide" />\n');
  await repo.git('commit', '-am', 'engine: widen carousel');
  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Tapico","maxWidth":"wide"}\n');

  const rendering = await renderingChanges();
  check('rendering change detected', rendering.includes('src/components/project/ProjectImage.astro'), rendering.join(', '));

  const status = await publishStatus();
  check('canPublish false', status.canPublish === false);
  check('rendersContent true', status.rendersContent === true);

  const blocked = await publishContent({});
  check('blocked without override', blocked.ok === false && blocked.needsOverride === true, blocked.error);
  check('origin unchanged', !(await contentOnOrigin(repo)).includes('maxWidth'));

  const forced = await publishContent({}, { force: true });
  check('override publishes', forced.ok === true && forced.pushed === true, forced.error);
  check('origin has the edit', (await contentOnOrigin(repo)).includes('maxWidth'));
  check(
    'rendering code did not travel to main',
    !(await execFile('git', ['show', 'main:src/components/project/ProjectImage.astro'], { cwd: repo.origin })).stdout.includes('wide'),
  );
});

await inRepo('uncommitted rendering change also blocks', async (repo) => {
  await repo.git('switch', '-c', 'feat/wip');
  await writeFile(path.join(repo.work, 'src/components/project/ProjectImage.astro'), '<img class="wip" />\n');
  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Tapico wip"}\n');

  const status = await publishStatus();
  check('rendersContent true', status.rendersContent === true, status.renderingFiles.join(', '));
  const blocked = await publishContent({});
  check('blocked', blocked.ok === false && blocked.needsOverride === true, blocked.error);
});

await inRepo('main moved on the same file → refuses to clobber', async (repo) => {
  await repo.git('switch', '-c', 'feat/copy-tweak');
  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Tapico from branch"}\n');

  // Someone else publishes to main in the meantime.
  const other = path.join(repo.root, 'other');
  await execFile('git', ['clone', repo.origin, other]);
  await execFile('git', ['config', 'user.email', 'other@example.com'], { cwd: other });
  await execFile('git', ['config', 'user.name', 'Other'], { cwd: other });
  await writeFile(path.join(other, 'src/content/projects/tapico.json'), '{"title":"Tapico from elsewhere"}\n');
  await execFile('git', ['commit', '-am', 'content: update tapico'], { cwd: other });
  await execFile('git', ['push', 'origin', 'main'], { cwd: other });

  const result = await publishContent({});
  check('refused', result.ok === false && /newer edits/.test(result.error), result.error);
  check('the other edit survives', (await contentOnOrigin(repo)).includes('Tapico from elsewhere'));
});

await inRepo('deleting content off-branch publishes the deletion', async (repo) => {
  await repo.git('switch', '-c', 'feat/prune');
  await rm(path.join(repo.work, 'src/content/projects/tapico.json'));

  const status = await publishStatus();
  check('sees the deletion', status.files.includes('src/content/projects/tapico.json'), status.files.join(', '));

  const result = await publishContent({});
  check('published', result.ok === true, result.error);
  check('file is gone from main', !(await originHasFile(repo, 'src/content/projects/tapico.json')));
});

await inRepo('new untracked content off-branch publishes', async (repo) => {
  await repo.git('switch', '-c', 'feat/new-page');
  await writeFile(path.join(repo.work, 'src/content/projects/newthing.json'), '{"title":"New"}\n');

  const status = await publishStatus();
  check('sees the new file', status.files.includes('src/content/projects/newthing.json'), status.files.join(', '));

  const result = await publishContent({});
  check('published', result.ok === true, result.error);
  check('file is on main', await originHasFile(repo, 'src/content/projects/newthing.json'));
});

console.log(failures ? `\n${failures} failing check(s)\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
