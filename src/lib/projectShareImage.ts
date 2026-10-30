import { isPlaceholderCoverSrc } from './placeholderCover.mjs';

const SHARE_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|avif|gif)$/i;

/**
 * First content image a project's own page renders, for a share card when the
 * project carries no listing cover.
 *
 * Matches the `src` key only: `avatarSrc` (Reddit comments) and `logoSrc`
 * (press ticker) are chrome, not the work. Videos and the placeholder cover
 * are skipped — an `.mp4` has no `preview` tier, and a black token is worse
 * than the site default.
 *
 * Kept out of `projects.ts` so it stays importable outside Vite: that module
 * reaches for `import.meta.glob`, which a plain test runner cannot provide.
 */
export function firstProjectSectionImage(
  sections: Array<Record<string, unknown>>,
): string | undefined {
  let found: string | undefined;
  const visit = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (found) return;
      if (
        key === 'src'
        && typeof value === 'string'
        && SHARE_IMAGE_EXTENSIONS.test(value)
        && !isPlaceholderCoverSrc(value)
      ) {
        found = value;
        return;
      }
      visit(value);
    }
  };
  visit(sections);
  return found;
}
