// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const { publishContent, publishStatus, renderingChanges, revertUnpublishedContent } = await import('../dev-publish.mjs');
let failures = 0;
const check = (label, value, detail = '') => {
  if (value) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-content-repo-'));
  const origin = path.join(root, 'content-origin.git');
  const work = path.join(root, 'work');
  await mkdir(work, { recursive: true });
  const git = (...args) => execFile('git', args, { cwd: work });
  await execFile('git', ['init', '-b', 'main', work]);
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Publish Test');
  await writeFile(path.join(work, '.gitignore'), 'src/content/\nmedia/\n.content.git/\n');
  await writeFile(path.join(work, 'README.md'), 'engine\n');
  await git('add', '.gitignore', 'README.md');
  await git('commit', '-m', 'engine');
  await mkdir(path.join(work, 'src/content/projects'), { recursive: true });
  await writeFile(path.join(work, 'src/content/projects/sample.json'), '{"title":"before"}\n');
  await execFile('git', ['--git-dir=.content.git', '--work-tree=.', 'init', '-b', 'main'], { cwd: work });
  const cgit = (...args) => execFile('git', ['--git-dir=.content.git', '--work-tree=.', ...args], { cwd: work });
  await cgit('config', 'user.email', 'test@example.com');
  await cgit('config', 'user.name', 'Publish Test');
  await cgit('add', '-f', 'src/content/projects/sample.json');
  await cgit('commit', '-m', 'content');
  await execFile('git', ['init', '--bare', '-b', 'main', origin]);
  await cgit('remote', 'add', 'origin', origin);
  await cgit('push', '-u', 'origin', 'main');
  await cgit('config', 'status.showUntrackedFiles', 'no');
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const ssh = path.join(bin, 'ssh');
  await writeFile(ssh, '#!/bin/sh\ncat >/dev/null\nprintf \'{"subject":"content: fixture"}\\n\'\n');
  await chmod(ssh, 0o755);
  return { root, work, origin, git, cgit, bin };
}

async function run(label, fn) {
  console.log(`\n${label}`);
  const repo = await fixture();
  const previous = process.cwd();
  const previousPath = process.env.PATH;
  process.chdir(repo.work);
  process.env.PATH = `${repo.bin}:${previousPath}`;
  try { await fn(repo); } catch (error) { failures += 1; console.log(`  ✗ threw — ${error instanceof Error ? error.message : error}`); }
  finally { process.chdir(previous); process.env.PATH = previousPath; await rm(repo.root, { recursive: true, force: true }); }
}

await run('separate content repo publishes content without touching engine index', async (repo) => {
  await writeFile(path.join(repo.work, 'src/content/projects/sample.json'), '{"title":"after"}\n');
  await writeFile(path.join(repo.work, 'README.md'), 'engine staged\n');
  await repo.git('add', 'README.md');
  const before = (await repo.git('rev-parse', 'HEAD')).stdout.trim();
  const result = await publishContent({});
  check('published', result.ok === true && result.pushed === true, result.error);
  check('engine HEAD/index unchanged', (await repo.git('rev-parse', 'HEAD')).stdout.trim() === before);
  check('engine staged file remains', (await repo.git('diff', '--cached', '--name-only')).stdout.trim() === 'README.md');
  check('content origin has edit', (await execFile('git', ['--git-dir', repo.origin, 'show', 'main:src/content/projects/sample.json'])).stdout.includes('after'));
});

await run('content branch and rendering gates refuse', async (repo) => {
  await repo.cgit('switch', '-c', 'draft');
  await writeFile(path.join(repo.work, 'src/content/projects/sample.json'), '{"title":"draft"}\n');
  const status = await publishStatus();
  check('content branch is reported', status.contentBranch === 'draft');
  check('publish unavailable off content main', status.canPublish === false);
  const refused = await publishContent({});
  check('publish refuses off content main', refused.ok === false && /must be on main/.test(refused.error));
});

await run('ignored media and deletions publish, then repeated publish works', async (repo) => {
  const media = path.join(repo.work, 'media', 'new file ñ.bin');
  await mkdir(path.dirname(media), { recursive: true });
  await writeFile(media, 'binary');
  await rm(path.join(repo.work, 'src/content/projects/sample.json'));
  check('status sees deletion and media', (await publishStatus()).files.some((file) => file.includes('sample.json')));
  const first = await publishContent({});
  check('publishes deletion/media', first.ok === true && first.pushed === true, first.error);
  await writeFile(media, 'binary edited');
  const repeatedStatus = await publishStatus();
  check('status sees repeated media edit', repeatedStatus.files.includes('media/new file ñ.bin'), `${repeatedStatus.files.join(', ')} / ${(await repo.cgit('diff', '--name-only', 'origin/main', '--', 'media')).stdout}`);
  const second = await publishContent({});
  check('publishes repeated edit', second.ok === true && second.pushed === true, second.error);
});

await run('staged private operations are refused', async (repo) => {
  await writeFile(path.join(repo.work, 'ops-private.txt'), 'private\n');
  await repo.cgit('add', '-f', 'ops-private.txt');
  await repo.cgit('commit', '-m', 'content: private fixture');
  await writeFile(path.join(repo.work, 'ops-private.txt'), 'changed\n');
  await repo.cgit('add', 'ops-private.txt');
  await writeFile(path.join(repo.work, 'src/content/projects/sample.json'), '{"title":"content"}\n');
  const result = await publishContent({});
  check('refuses staged private path', result.ok === false && /Non-content files are staged/.test(result.error), result.error);
});

await run('non-content intermediate commit is refused even when net diff is clean', async (repo) => {
  await writeFile(path.join(repo.work, 'ops-intermediate.txt'), 'bad\n');
  await repo.cgit('add', '-f', 'ops-intermediate.txt');
  await repo.cgit('commit', '-m', 'bad add');
  await rm(path.join(repo.work, 'ops-intermediate.txt'));
  await repo.cgit('add', '-u', '--', 'ops-intermediate.txt');
  await repo.cgit('commit', '-m', 'bad delete');
  await writeFile(path.join(repo.work, 'src/content/projects/sample.json'), '{"title":"content"}\n');
  const result = await publishContent({});
  check('refuses history containing private path', result.ok === false && /contains non-content/.test(result.error), result.error);
});

await run('failed push can be retried from local content commit', async (repo) => {
  const hook = path.join(repo.origin, 'hooks', 'pre-receive');
  const marker = path.join(repo.root, 'hook-used');
  await writeFile(hook, `#!/bin/sh\nif [ ! -e '${marker}' ]; then touch '${marker}'; exit 1; fi\nexit 0\n`);
  await chmod(hook, 0o755);
  await writeFile(path.join(repo.work, 'src/content/projects/sample.json'), '{"title":"retry"}\n');
  const failed = await publishContent({});
  check('reports push failure with commit kept', failed.ok === true && failed.pushed === false, failed.error);
  const retried = await publishContent({});
  check('retry pushes existing local commit', retried.ok === true && retried.pushed === true, retried.error);
});

await run('foreign remote edit is rejected before publish', async (repo) => {
  const other = path.join(repo.root, 'other');
  await execFile('git', ['clone', repo.origin, other]);
  await execFile('git', ['config', 'user.email', 'other@example.com'], { cwd: other });
  await execFile('git', ['config', 'user.name', 'Other'], { cwd: other });
  await writeFile(path.join(other, 'src/content/projects/sample.json'), '{"title":"foreign"}\n');
  await execFile('git', ['add', '.'], { cwd: other });
  await execFile('git', ['commit', '-m', 'foreign'], { cwd: other });
  await execFile('git', ['push', 'origin', 'main'], { cwd: other });
  await writeFile(path.join(repo.work, 'src/content/projects/sample.json'), '{"title":"local"}\n');
  const result = await publishContent({});
  check('refuses foreign edit', result.ok === false && /newer edits|Update/.test(result.error), result.error);
});

await run('engine rendering gate and force keep content repo separate', async (repo) => {
  await repo.git('switch', '-c', 'engine-renderer');
  await mkdir(path.join(repo.work, 'src/components/project'), { recursive: true });
  await writeFile(path.join(repo.work, 'src/components/project/Renderer.astro'), '<div>new renderer</div>\n');
  await repo.git('add', 'src/components/project/Renderer.astro');
  await repo.git('commit', '-m', 'engine renderer');
  await writeFile(path.join(repo.work, 'src/content/projects/sample.json'), '{"title":"renderer dependent"}\n');
  const blocked = await publishContent({});
  check('blocks renderer change', blocked.ok === false && blocked.needsOverride === true);
  const forced = await publishContent({}, { force: true });
  check('force publishes content only', forced.ok === true && forced.pushed === true, forced.error);
});

await run('revert restores content but preserves engine bytes and index', async (repo) => {
  await writeFile(path.join(repo.work, 'README.md'), 'engine dirty\n');
  await repo.git('add', 'README.md');
  await writeFile(path.join(repo.work, 'src/content/projects/sample.json'), '{"title":"local"}\n');
  const result = await revertUnpublishedContent();
  check('revert succeeds', result.ok === true, result.error);
  check('content restored', (await readFile(path.join(repo.work, 'src/content/projects/sample.json'), 'utf8')).includes('before'));
  check('engine index preserved', (await repo.git('diff', '--cached', '--name-only')).stdout.trim() === 'README.md');
  check('engine bytes preserved', (await readFile(path.join(repo.work, 'README.md'), 'utf8')).includes('engine dirty'));
});

await run('review preview is read-only', async (repo) => {
  await mkdir(path.join(repo.work, '.dev-session'), { recursive: true });
  await writeFile(path.join(repo.work, '.dev-session/content-snapshot.json'), '{}\n');
  const status = await publishStatus();
  check('status is read-only', status.readOnly === true && status.files.length === 0);
  const result = await publishContent({}, { force: true });
  check('force cannot publish preview', result.ok === false && /review preview/.test(result.error));
  const reverted = await revertUnpublishedContent();
  check('revert refuses remote restore', reverted.ok === false && /review preview/.test(reverted.error));
});

console.log(failures ? `\n${failures} failing check(s)\n` : '\nAll content-repository checks passed\n');
process.exit(failures ? 1 : 0);
