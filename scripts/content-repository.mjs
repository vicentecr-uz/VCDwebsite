import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';

export const CONTENT_REPO_PATHS = [
  'src/content',
  'media',
  'public/images',
  'public/videos',
  'sitemap',
  'ops',
  'scripts/vps-agent.py',
  'scripts/test/vps-agent.test.py',
  'scripts/build-view.mjs',
  'uploads',
  '.github/workflows/content-deploy.yml',
];

function contentGitPath(cwd) {
  const candidate = path.resolve(cwd, '.content.git');
  try {
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Invalid .content.git at ${candidate}`);
    }
    return candidate;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function contentGitArgs(cwd = process.cwd()) {
  const gitDir = contentGitPath(cwd);
  return gitDir ? [`--git-dir=${gitDir}`, `--work-tree=${path.resolve(cwd)}`] : [];
}

export function hasContentRepository(cwd = process.cwd()) {
  return contentGitPath(cwd) !== null;
}

export function isReviewPreview(cwd = process.cwd()) {
  return process.env.VCD_REVIEW_PREVIEW === '1'
    || existsSync(path.resolve(cwd, '.dev-session/content-snapshot.json'));
}
