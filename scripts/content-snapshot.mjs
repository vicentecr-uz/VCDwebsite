import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, lstat, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CONTENT_REPO_PATHS, hasContentRepository } from './content-repository.mjs';

const execFile = promisify(execFileCallback);
const MARKER = '.dev-session/content-snapshot.json';

async function gitCommonDir(cwd) {
  const { stdout } = await execFile('git', ['rev-parse', '--git-common-dir'], { cwd });
  const common = stdout.trim();
  return path.resolve(cwd, common);
}

async function assertNoSymlinkAncestors(root, target, label) {
  let current = path.resolve(target);
  const stop = path.resolve(root);
  while (current !== stop && current.startsWith(`${stop}${path.sep}`)) {
    const stat = await lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error(`Refusing symlink ${label}: ${path.relative(root, current)}`);
    current = path.dirname(current);
  }
}

async function walk(source, destination, relative, plan, root = false) {
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error(`Refusing symlink source: ${relative}`);
  const destinationStat = await lstat(destination).catch(() => null);
  if (destinationStat) {
    if (destinationStat.isSymbolicLink()) throw new Error(`Refusing symlink destination: ${relative}`);
    throw new Error(`Refusing to overwrite private destination path: ${relative}`);
  } else {
    if (root) plan.created.push(destination);
  }

  if (sourceStat.isDirectory()) {
    const entries = await readdir(source);
    for (const entry of entries) await walk(path.join(source, entry), path.join(destination, entry), `${relative}/${entry}`, plan);
  }
}

function copyArgs() { return os.platform() === 'darwin' ? ['-cR'] : ['-R']; }

async function copyEntry(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await execFile('cp', [...copyArgs(), source, destination]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (os.platform() !== 'darwin' || !/clone|reflink|invalid option|illegal option/i.test(message)) throw error;
    await rm(destination, { recursive: true, force: true });
    await execFile('cp', ['-R', source, destination]);
  }
}

export async function prepareContentSnapshot(cwd = process.cwd(), source) {
  const destination = path.resolve(cwd);
  if (hasContentRepository(destination)) {
    throw new Error('Review preview destination already has a content repository.');
  }
  const marker = path.join(destination, MARKER);
  const markerParent = path.dirname(marker);
  const markerParentStat = await lstat(markerParent).catch(() => null);
  if (markerParentStat?.isSymbolicLink()) throw new Error('Refusing symlink marker parent.');
  if (existsSync(marker)) return { copied: false, preserved: true, marker };

  let primary = source;
  if (!primary) {
    const commonDir = await gitCommonDir(destination);
    primary = path.dirname(commonDir);
  }
  primary = path.resolve(primary);
  if (primary === destination || !existsSync(primary) || !hasContentRepository(primary)) {
    return { copied: false, precutover: true };
  }

  const plan = { created: [] };
  for (const relative of CONTENT_REPO_PATHS) {
    const sourcePath = path.join(primary, relative);
    if (!existsSync(sourcePath)) continue;
    const destinationPath = path.join(destination, relative);
    await assertNoSymlinkAncestors(primary, sourcePath, 'source');
    await assertNoSymlinkAncestors(destination, path.dirname(destinationPath), 'destination parent');
    await walk(sourcePath, destinationPath, relative, plan, true);
  }

  try {
    for (const relative of CONTENT_REPO_PATHS) {
      const sourcePath = path.join(primary, relative);
      if (!existsSync(sourcePath)) continue;
      const destinationPath = path.join(destination, relative);
      await copyEntry(sourcePath, destinationPath);
    }
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, `${JSON.stringify({ source: primary, paths: CONTENT_REPO_PATHS })}\n`);
    return { copied: true, marker, source: primary };
  } catch (error) {
    for (const created of plan.created.reverse()) await rm(created, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.main) {
  const cwd = path.resolve(process.argv[2] || process.cwd());
  try {
    await prepareContentSnapshot(cwd);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
