// @ts-check
/**
 * Colour-token publish to main (issue #109).
 * `bun scripts/test/publish-styles.test.mjs`
 */
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const { publishStyles, stylesPublishStatus, commitStyleTokensOnBranch, STYLE_TOKEN_PATHS } = await import('../dev-commit-engine.mjs');
/** These fixtures only touch the CSS half of STYLE_TOKEN_PATHS — the design-tokens.json half is exercised for real by tokens:check/build. */
const STYLE_TOKEN_PATH = STYLE_TOKEN_PATHS[0];

let failures = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-styles-test-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');

  await execFile('git', ['init', '--bare', '-b', 'main', origin]);
  await execFile('git', ['clone', origin, work]);

  const git = (...args) => execFile('git', args, { cwd: work });
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Styles Test');

  await mkdir(path.join(work, 'src/styles'), { recursive: true });
  await mkdir(path.join(work, 'tokens'), { recursive: true });
  await mkdir(path.join(work, 'src/content/projects'), { recursive: true });
  await writeFile(path.join(work, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #ffffff; }\n');
  await writeFile(path.join(work, STYLE_TOKEN_PATHS[1]), '{"ref":{"palette":{"grey":{"1000":{"$type":"color","$value":"#ffffff"}}}}}\n');
  const sampleProject = await readFile(path.resolve(import.meta.dirname, 'fixtures/content/src/content/projects/sample-modern.json'), 'utf8');
  await writeFile(path.join(work, 'src/content/projects/sample-modern.json'), sampleProject);
  await writeFile(path.join(work, 'README.md'), 'engine\n');
  await git('add', '.');
  await git('commit', '-m', 'initial');
  await git('push', 'origin', 'main');

  return { root, origin, work, git };
}

async function inRepo(label, fn) {
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

const stylesOnOrigin = async (repo) => {
  const { stdout } = await execFile('git', ['show', `main:${STYLE_TOKEN_PATH}`], { cwd: repo.origin });
  return stdout;
};

await inRepo('on main, clean → nothing to publish', async () => {
  const status = await stylesPublishStatus();
  check('no unpublished styles', status.files.length === 0, status.files.join(', '));
  const result = await publishStyles({});
  check('refuses', result.ok === false && /No style changes/.test(result.error), result.error);
});

await inRepo('on main, dirty global.css → publishes in place', async (repo) => {
  await writeFile(path.join(repo.work, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #111111; }\n');
  const status = await stylesPublishStatus();
  check('sees dirty file', status.files.includes(STYLE_TOKEN_PATH), status.files.join(', '));

  const result = await publishStyles({ message: 'styles: update colour tokens' });
  check('published', result.ok === true && result.pushed === true, result.error);
  check('main has new colour', (await stylesOnOrigin(repo)).includes('#111111'));
  check('working tree matches main', (await stylesPublishStatus()).files.length === 0);
});

await inRepo('off main, save commits on branch before publish', async (repo) => {
  await repo.git('switch', '-c', 'feat/tokens');
  await writeFile(path.join(repo.work, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #abcdef; }\n');

  const commit = await commitStyleTokensOnBranch({ tokens: ['--sys-color-srf'] });
  check('committed on branch', commit.ok === true && commit.committed === true, commit.error);

  const beforeBranch = (await repo.git('branch', '--show-current')).stdout.trim();
  check('still on feature branch before', beforeBranch === 'feat/tokens');

  const result = await publishStyles({});
  check('published', result.ok === true && result.pushed === true, result.error);
  check('main has new colour', (await stylesOnOrigin(repo)).includes('#abcdef'));

  const afterBranch = (await repo.git('branch', '--show-current')).stdout.trim();
  check('still on feature branch after', afterBranch === 'feat/tokens');
  check('status clear vs main', (await stylesPublishStatus()).files.length === 0);

  const { stdout: porcelain } = await repo.git('status', '--porcelain', '--', STYLE_TOKEN_PATH);
  check('working tree clean vs feature tip', porcelain.trim().length === 0, porcelain);
});

await inRepo('save commit is idempotent when already committed', async (repo) => {
  await repo.git('switch', '-c', 'feat/tokens');
  await writeFile(path.join(repo.work, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #abcdef; }\n');

  const first = await commitStyleTokensOnBranch({ tokens: ['--sys-color-srf'] });
  check('first commit', first.ok === true && first.committed === true, first.error);

  const second = await commitStyleTokensOnBranch({ tokens: ['--sys-color-srf'] });
  check('second skipped', second.ok === true && second.skipped === true, second.error);
});

await inRepo('content stays out of a styles publish', async (repo) => {
  await repo.git('switch', '-c', 'feat/tokens-only');
  await writeFile(path.join(repo.work, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #222222; }\n');
  await writeFile(path.join(repo.work, 'src/content/projects/sample-modern.json'), '{"title":"Should not ship"}\n');
  await commitStyleTokensOnBranch({ tokens: ['--sys-color-srf'] });

  const result = await publishStyles({});
  check('published styles', result.ok === true, result.error);
  check('only styles in the commit', Array.isArray(result.files) && result.files.length === 1
    && result.files[0] === STYLE_TOKEN_PATH, JSON.stringify(result.files));

  const { stdout: content } = await execFile('git', ['show', 'main:src/content/projects/sample-modern.json'], {
    cwd: repo.origin,
  });
  const parsedContent = JSON.parse(content);
  check('content unchanged on main', parsedContent.title === 'Sample modern' && !content.includes('Should not ship'));
});

await inRepo('main moved on global.css → refuses to clobber', async (repo) => {
  await repo.git('switch', '-c', 'feat/stale');
  await writeFile(path.join(repo.work, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #aaaaaa; }\n');
  await commitStyleTokensOnBranch({ tokens: ['--sys-color-srf'] });

  const other = path.join(repo.root, 'other');
  await execFile('git', ['clone', repo.origin, other]);
  await execFile('git', ['config', 'user.email', 'other@example.com'], { cwd: other });
  await execFile('git', ['config', 'user.name', 'Other'], { cwd: other });
  await writeFile(path.join(other, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #bbbbbb; }\n');
  await execFile('git', ['commit', '-am', 'styles: elsewhere'], { cwd: other });
  await execFile('git', ['push', 'origin', 'main'], { cwd: other });

  const result = await publishStyles({});
  check('refused', result.ok === false && /newer edits/.test(result.error), result.error);
  check('other edit survives', (await stylesOnOrigin(repo)).includes('#bbbbbb'));
});

await inRepo('review preview environment refuses styles publish', async (repo) => {
  await writeFile(path.join(repo.work, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #cccccc; }\n');
  const previous = process.env.VCD_REVIEW_PREVIEW;
  process.env.VCD_REVIEW_PREVIEW = '1';
  try {
    const status = await stylesPublishStatus();
    check('reports read-only', status.readOnly === true && status.canPublish === false);
    const result = await publishStyles({ force: true });
    check('refuses publish', result.ok === false && /review preview/.test(result.error), result.error);
  } finally {
    if (previous === undefined) delete process.env.VCD_REVIEW_PREVIEW;
    else process.env.VCD_REVIEW_PREVIEW = previous;
  }
});

await inRepo('review preview marker refuses styles publish', async (repo) => {
  await mkdir(path.join(repo.work, '.dev-session'), { recursive: true });
  await writeFile(path.join(repo.work, '.dev-session/content-snapshot.json'), '{}\n');
  await writeFile(path.join(repo.work, STYLE_TOKEN_PATH), ':root { --sys-color-srf: #dddddd; }\n');
  const status = await stylesPublishStatus();
  check('marker reports read-only', status.readOnly === true && status.canPublish === false);
  const result = await publishStyles({});
  check('marker refuses publish', result.ok === false && /review preview/.test(result.error), result.error);
});

console.log(failures ? `\n${failures} failing check(s)\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
