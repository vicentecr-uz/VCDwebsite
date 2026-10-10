// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const { generateMessage } = await import('../dev-publish.mjs');
const { requestVpsAgent } = await import('../vps-agent.mjs');

const root = await mkdtemp(path.join(os.tmpdir(), 'vcd-message-test-'));
const fakeBin = path.join(root, 'bin');
const capture = path.join(root, 'request.json');
const repo = path.join(root, 'repo');
await execFile('git', ['init', '-b', 'main', repo]);
await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
await execFile('git', ['config', 'user.name', 'Message Test'], { cwd: repo });
await execFile('mkdir', ['-p', path.join(repo, 'src/content')]);
await writeFile(path.join(repo, 'src/content/page.json'), '{"title":"Before"}\n');
await execFile('git', ['add', '.'], { cwd: repo });
await execFile('git', ['commit', '-m', 'initial'], { cwd: repo });
await execFile('mkdir', ['-p', fakeBin]);
const ssh = path.join(fakeBin, 'ssh');
await writeFile(ssh, `#!/bin/sh
cat > ${capture}
case "\$VCD_TEST_MODE" in
  nonzero) exit 7 ;;
  empty) exit 0 ;;
  timeout) sleep 1 ;;
esac
printf '%s' '{"subject":"Revise page copy"}'
`);
await chmod(ssh, 0o755);

const previous = process.cwd();
const previousPath = process.env.PATH;
process.env.PATH = `${fakeBin}:${previousPath}`;
process.chdir(repo);
try {
  await writeFile(path.join(repo, 'src/content/page.json'), '{"title":"Staged"}\n');
  await execFile('git', ['add', '.'], { cwd: repo });
  await writeFile(path.join(repo, 'src/content/page.json'), '{"title":"Unstaged"}\n');

  const result = await generateMessage({ documents: ['page'] }, ['src/content/page.json'], {
    PATH: `${fakeBin}:${process.env.PATH}`,
  });
  if (!result.generated || result.message !== 'content: Revise page copy') {
    throw new Error(`unexpected generated result: ${JSON.stringify(result)}`);
  }
  const request = JSON.parse(await readFile(capture, 'utf8'));
  if (!request.diff.includes('Staged') || request.diff.includes('Unstaged')) {
    throw new Error(`diff was not staged-only: ${request.diff}`);
  }

  const scratchIndex = path.join(root, 'scratch-index');
  await execFile('git', ['read-tree', 'HEAD'], { cwd: repo, env: { ...process.env, GIT_INDEX_FILE: scratchIndex } });
  const scratchFile = path.join(root, 'scratch-page.json');
  await writeFile(scratchFile, '{"title":"Scratch staged"}\n');
  const { stdout: blob } = await execFile('git', ['hash-object', '-w', '--', scratchFile], { cwd: repo });
  await execFile('git', ['update-index', '--add', '--cacheinfo', `100644,${blob.trim()},src/content/page.json`], {
    cwd: repo,
    env: { ...process.env, GIT_INDEX_FILE: scratchIndex },
  });
  await generateMessage({ documents: ['page'] }, ['src/content/page.json'], {
    PATH: `${fakeBin}:${process.env.PATH}`,
    GIT_INDEX_FILE: scratchIndex,
  }, 'HEAD');
  const scratchRequest = JSON.parse(await readFile(capture, 'utf8'));
  if (!scratchRequest.diff.includes('Scratch staged')) {
    throw new Error(`scratch index diff was not used: ${scratchRequest.diff}`);
  }

  for (const mode of ['nonzero', 'empty', 'timeout']) {
    process.env.VCD_TEST_MODE = mode;
    let rejected = false;
    try {
      await requestVpsAgent({ task: 'subject' }, { timeout: mode === 'timeout' ? 20 : 100 });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`${mode} SSH response did not reject`);
  }
  delete process.env.VCD_TEST_MODE;

  await writeFile(ssh, `#!/bin/sh
cat >/dev/null
printf '%s' 'not-json'
`);
  await chmod(ssh, 0o755);
  const fallback = await generateMessage({ documents: ['page'] }, ['src/content/page.json'], {
    PATH: `${fakeBin}:${process.env.PATH}`,
  });
  if (fallback.generated || fallback.message !== 'content: update page') {
    throw new Error(`malformed output did not fall back: ${JSON.stringify(fallback)}`);
  }
} finally {
  process.env.PATH = previousPath;
  process.chdir(previous);
  await rm(root, { recursive: true, force: true });
}

console.log('publish-message tests passed');
