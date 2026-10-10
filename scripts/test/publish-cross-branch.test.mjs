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
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const { publishContent, publishStatus, renderingChanges, revertUnpublishedContent } = await import('../dev-publish.mjs');

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
  await mkdir(path.join(work, 'src/content/settings'), { recursive: true });
  await mkdir(path.join(work, 'src/components/project'), { recursive: true });
  await writeFile(path.join(work, 'src/content/projects/tapico.json'), '{"title":"Tapico"}\n');
  await writeFile(path.join(work, 'src/content/settings/header.json'), '{"menuLinks":[]}\n');
  await writeFile(path.join(work, 'src/components/Header.astro'), '<header />\n');
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

await inRepo('header renderer change blocks publishing header settings', async (repo) => {
  const rendererPath = 'src/components/Header.astro';
  await repo.git('switch', '-c', 'feat/header-freshness');
  await writeFile(path.join(repo.work, rendererPath), 'engine change\n');
  await repo.git('add', rendererPath);
  await repo.git('commit', '-m', 'engine: read header settings during dev SSR');
  await writeFile(path.join(repo.work, 'src/content/settings/header.json'), '{"menuLinks":[{"label":"Physical"}]}\n');

  const status = await publishStatus();
  check('header renderer detected', status.renderingFiles.includes(rendererPath), status.renderingFiles.join(', '));
  check('header settings publish blocked', status.canPublish === false);
  const blocked = await publishContent({});
  check('refuses without override', blocked.ok === false && blocked.needsOverride === true, blocked.error);
  check('origin header settings unchanged', !(await contentOnOrigin(repo, 'src/content/settings/header.json')).includes('Physical'));
});

await inRepo('publishing twice from the same branch keeps working', async (repo) => {
  // The branch never rebases, so after the first publish main carries a commit
  // to this file that the merge base predates. That is our own commit, and a
  // guard that cannot tell it apart makes cross-branch publish a one-shot.
  await repo.git('switch', '-c', 'feat/copy-tweak');

  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"First"}\n');
  const first = await publishContent({});
  check('first publish', first.ok === true, first.error);

  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Second"}\n');
  check('sees it as unpublished again', (await publishStatus()).files.includes('src/content/projects/tapico.json'));
  const second = await publishContent({});
  check('second publish', second.ok === true, second.error);
  check('origin has the second edit', (await contentOnOrigin(repo)).includes('Second'));

  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Third"}\n');
  const third = await publishContent({});
  check('third publish', third.ok === true, third.error);
  check('origin has the third edit', (await contentOnOrigin(repo)).includes('Third'));
  check('branch never moved', (await repo.git('rev-list', '--count', 'HEAD')).stdout.trim() === '1');
});

await inRepo('a foreign edit still blocks after we have published', async (repo) => {
  // Same shape as above, but someone else lands on top of our publish — the
  // record must not wave that through.
  await repo.git('switch', '-c', 'feat/copy-tweak');
  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Ours"}\n');
  check('our publish', (await publishContent({})).ok === true);

  const other = path.join(repo.root, 'other');
  await execFile('git', ['clone', repo.origin, other]);
  await execFile('git', ['config', 'user.email', 'other@example.com'], { cwd: other });
  await execFile('git', ['config', 'user.name', 'Other'], { cwd: other });
  await writeFile(path.join(other, 'src/content/projects/tapico.json'), '{"title":"Theirs"}\n');
  await execFile('git', ['commit', '-am', 'content: update tapico'], { cwd: other });
  await execFile('git', ['push', 'origin', 'main'], { cwd: other });

  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Ours again"}\n');
  const result = await publishContent({});
  check('refused', result.ok === false && /newer edits/.test(result.error), result.error);
  check('their edit survives', (await contentOnOrigin(repo)).includes('Theirs'));
});

await inRepo('branch behind main is reported as behind, not as unpublished', async (repo) => {
  // Anto publishes from main while a feature branch sits untouched. The branch's
  // copy is now the *older* one — nothing to publish, and offering to publish it
  // would revert the edit that just went out.
  await repo.git('switch', '-c', 'feat/idle');

  const other = path.join(repo.root, 'other');
  await execFile('git', ['clone', repo.origin, other]);
  await execFile('git', ['config', 'user.email', 'other@example.com'], { cwd: other });
  await execFile('git', ['config', 'user.name', 'Other'], { cwd: other });
  await writeFile(path.join(other, 'src/content/projects/tapico.json'), '{"title":"Published from main"}\n');
  await execFile('git', ['commit', '-am', 'content: update tapico'], { cwd: other });
  await execFile('git', ['push', 'origin', 'main'], { cwd: other });
  await repo.git('fetch', 'origin', 'main');

  const status = await publishStatus();
  check('nothing to publish', status.files.length === 0, status.files.join(', '));
  check('reported as behind', status.behind.includes('src/content/projects/tapico.json'), status.behind.join(', '));

  const result = await publishContent({});
  check('publish is a no-op, not a revert', result.ok === false && /No content changes/.test(result.error), result.error);
  check('the newer edit survives', (await contentOnOrigin(repo)).includes('Published from main'));
});

await inRepo('editing a file main moved is still publishable', async (repo) => {
  // Same setup, but this time we do edit it — that is a real unpublished change,
  // and the staleness guard is what decides whether it may land.
  await repo.git('switch', '-c', 'feat/idle');

  const other = path.join(repo.root, 'other');
  await execFile('git', ['clone', repo.origin, other]);
  await execFile('git', ['config', 'user.email', 'other@example.com'], { cwd: other });
  await execFile('git', ['config', 'user.name', 'Other'], { cwd: other });
  await writeFile(path.join(other, 'src/content/projects/tapico.json'), '{"title":"From main"}\n');
  await execFile('git', ['commit', '-am', 'content: update tapico'], { cwd: other });
  await execFile('git', ['push', 'origin', 'main'], { cwd: other });
  await repo.git('fetch', 'origin', 'main');

  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"My own edit"}\n');
  const status = await publishStatus();
  check('counted as unpublished', status.files.includes('src/content/projects/tapico.json'));
  check('not counted as behind', status.behind.length === 0, status.behind.join(', '));

  const result = await publishContent({});
  check('refused as stale', result.ok === false && /newer edits/.test(result.error), result.error);
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

await inRepo('revert restores ahead content to match main', async (repo) => {
  await repo.git('switch', '-c', 'feat/copy-tweak');
  await writeFile(path.join(repo.work, 'README.md'), 'engine edited\n');
  await repo.git('commit', '-am', 'engine: tweak readme');
  await writeFile(path.join(repo.work, 'src/content/projects/tapico.json'), '{"title":"Local only"}\n');

  check('sees unpublished content', (await publishStatus()).files.includes('src/content/projects/tapico.json'));

  const result = await revertUnpublishedContent();
  check('reverted', result.ok === true, result.error);
  check('restored tapico', Array.isArray(result.restored) && result.restored.includes('src/content/projects/tapico.json'));
  check(
    'working file matches main',
    (await readFile(path.join(repo.work, 'src/content/projects/tapico.json'), 'utf8')).includes('"title":"Tapico"'),
  );
  check('nothing left unpublished', (await publishStatus()).files.length === 0);
  check(
    'engine commit left alone',
    (await readFile(path.join(repo.work, 'README.md'), 'utf8')).includes('engine edited'),
  );
});

await inRepo('revert deletes untracked content that never existed on main', async (repo) => {
  await repo.git('switch', '-c', 'feat/new-page');
  const newbie = path.join(repo.work, 'src/content/projects/newthing.json');
  await writeFile(newbie, '{"title":"New"}\n');

  check('sees the new file', (await publishStatus()).files.includes('src/content/projects/newthing.json'));

  const result = await revertUnpublishedContent();
  check('reverted', result.ok === true, result.error);
  check('listed as restored', Array.isArray(result.restored) && result.restored.includes('src/content/projects/newthing.json'));
  check('file is gone', !existsSync(newbie));
  check('nothing left unpublished', (await publishStatus()).files.length === 0);
});

await inRepo('revert keeps content committed on the branch but absent from main', async (repo) => {
  // The #211 shape: a whole content directory created and committed on a branch
  // main has never seen. Every file in it is "absent from main", which the old
  // revert read as untracked and deleted — 289 files on the real branch.
  await repo.git('switch', '-c', 'feat/media-store');
  const committed = path.join(repo.work, 'src/content/projects/branchnew.json');
  await writeFile(committed, '{"title":"Committed on branch"}\n');
  await repo.git('add', 'src/content/projects/branchnew.json');
  await repo.git('commit', '-m', 'content: add branch-new document (schema migration)');

  const stray = path.join(repo.work, 'src/content/projects/stray.json');
  await writeFile(stray, '{"title":"Never committed"}\n');

  const result = await revertUnpublishedContent();
  check('reverted', result.ok === true, result.error);
  check('committed file survives', existsSync(committed));
  check(
    'committed file keeps its contents',
    (await readFile(committed, 'utf8')).includes('Committed on branch'),
  );
  check('genuinely untracked file still deleted', !existsSync(stray));
});

await inRepo('revert restores an uncommitted edit to branch-committed content', async (repo) => {
  await repo.git('switch', '-c', 'feat/media-edit');
  const committed = path.join(repo.work, 'src/content/projects/branchnew.json');
  await writeFile(committed, '{"title":"Committed on branch"}\n');
  await repo.git('add', 'src/content/projects/branchnew.json');
  await repo.git('commit', '-m', 'content: add branch-new document (schema migration)');

  await writeFile(committed, '{"title":"Edited after commit"}\n');

  const result = await revertUnpublishedContent();
  check('reverted', result.ok === true, result.error);
  check('file survives', existsSync(committed));
  check(
    'restored to the committed version, not deleted',
    (await readFile(committed, 'utf8')).includes('Committed on branch'),
  );
});

await inRepo('revert preserves an existing path modified and committed on the branch', async (repo) => {
  await repo.git('switch', '-c', 'feat/content-migration');
  const migrated = path.join(repo.work, 'src/content/projects/tapico.json');
  await writeFile(migrated, '{"title":"Migrated on branch"}\n');
  await repo.git('add', 'src/content/projects/tapico.json');
  await repo.git('commit', '-m', 'content: migrate existing document');

  const stray = path.join(repo.work, 'src/content/projects/stray.json');
  await writeFile(stray, '{"title":"Never committed"}\n');

  const result = await revertUnpublishedContent();
  check('reverted', result.ok === true, result.error);
  check(
    'committed migration survives',
    (await readFile(migrated, 'utf8')).includes('Migrated on branch'),
  );
  check('genuinely untracked file still deleted', !existsSync(stray));
});

await inRepo('revert restores edits to an existing branch-migrated path from HEAD', async (repo) => {
  await repo.git('switch', '-c', 'feat/content-migration');
  const migrated = path.join(repo.work, 'src/content/projects/tapico.json');
  await writeFile(migrated, '{"title":"Migrated on branch"}\n');
  await repo.git('add', 'src/content/projects/tapico.json');
  await repo.git('commit', '-m', 'content: migrate existing document');

  await writeFile(migrated, '{"title":"Edited after migration"}\n');

  const result = await revertUnpublishedContent();
  check('reverted', result.ok === true, result.error);
  check(
    'restored branch version instead of main',
    (await readFile(migrated, 'utf8')).includes('Migrated on branch'),
  );
});

await inRepo('revert preserves a deletion committed on the branch', async (repo) => {
  await repo.git('switch', '-c', 'feat/content-migration');
  const migrated = path.join(repo.work, 'src/content/projects/tapico.json');
  await rm(migrated);
  await repo.git('add', 'src/content/projects/tapico.json');
  await repo.git('commit', '-m', 'content: delete migrated document');

  await writeFile(migrated, '{"title":"Resurrected working copy"}\n');

  const result = await revertUnpublishedContent();
  check('reverted', result.ok === true, result.error);
  check('committed deletion survives', !existsSync(migrated));
});

await inRepo('revert with nothing unpublished refuses', async () => {
  const result = await revertUnpublishedContent();
  check('refused', result.ok === false && /No unpublished content/.test(result.error), result.error);
});

console.log(failures ? `\n${failures} failing check(s)\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
