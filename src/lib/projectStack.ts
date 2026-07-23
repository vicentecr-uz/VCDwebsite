/** Vertical rhythm between project page sections (parent-owned stack). */
export type ProjectStackSpacing = 'related' | 'group' | 'section' | 'major' | 'none';

export function projectStackClass(
  spacing: ProjectStackSpacing = 'section',
  options?: { precedeRelated?: boolean; flush?: boolean },
): string {
  const classes: string[] = [];
  if (spacing === 'related') classes.push('project-stack--related');
  else if (spacing === 'group') classes.push('project-stack--group');
  else if (spacing === 'section') classes.push('project-stack--section');
  else if (spacing === 'major') classes.push('project-stack--major');
  else if (spacing === 'none') classes.push('project-stack--none');
  if (options?.precedeRelated) classes.push('project-stack--precede-related');
  if (options?.flush) classes.push('project-stack--flush');
  return classes.join(' ');
}

/** Prefer explicit `spacing`; else map legacy `tightTop` → related. */
export function resolveProjectSpacing(
  spacing?: ProjectStackSpacing,
  tightTop?: boolean,
): ProjectStackSpacing {
  if (spacing) return spacing;
  if (tightTop) return 'related';
  return 'section';
}

/**
 * Page-top (index 0) default is flush (none). Missing/`section` default was the
 * between-sibling gap token — on the first block that rendered as 0 via `* + *`.
 * Explicit related/group/major/none are kept; explicit section means page-top 8em.
 */
export function resolveStackSpacingForIndex(
  index: number,
  spacing?: ProjectStackSpacing,
  tightTop?: boolean,
): ProjectStackSpacing {
  if (index === 0) {
    if (spacing === undefined && !tightTop) return 'none';
    return resolveProjectSpacing(spacing, tightTop);
  }
  return resolveProjectSpacing(spacing, tightTop);
}

/**
 * DEV-only data attrs for on-page spacing edits. `sectionPath` points at the
 * section object in the project JSON (e.g. `['sections', 2]`); we append
 * `'spacing'` when writing.
 */
export function spacingDevAttrs(
  documentKey: string | undefined,
  sectionPath: Array<string | number> | undefined,
  spacing: ProjectStackSpacing,
): Record<string, string> | undefined {
  if (!import.meta.env.DEV || !documentKey || !sectionPath?.length) return undefined;
  return {
    'data-dev-spacing-document': documentKey,
    'data-dev-spacing-path': JSON.stringify([...sectionPath, 'spacing']),
    'data-dev-spacing-value': spacing,
  };
}
