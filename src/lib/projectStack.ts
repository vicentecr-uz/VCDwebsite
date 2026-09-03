/** Vertical rhythm between project page sections (parent-owned stack). */
export type ProjectStackSpacing = 'related' | 'group' | 'section' | 'major' | 'none';

const PROJECT_STACK_SPACING_ORDER: Record<ProjectStackSpacing, number> = {
  none: 0,
  related: 1,
  group: 2,
  section: 3,
  major: 4,
};

const largerProjectStackSpacing = (
  left: ProjectStackSpacing,
  right: ProjectStackSpacing,
) => PROJECT_STACK_SPACING_ORDER[left] >= PROJECT_STACK_SPACING_ORDER[right] ? left : right;

/** Values stay aligned to the original block identities; only their seams change. */
export function reorderProjectStackSpacings(
  spacings: ProjectStackSpacing[],
  sourceIndex: number,
  insertIndex: number,
): ProjectStackSpacing[] {
  const next = [...spacings];
  if (
    sourceIndex < 0
    || sourceIndex >= spacings.length
    || insertIndex < 0
    || insertIndex >= spacings.length
    || sourceIndex === insertIndex
  ) {
    return next;
  }

  const identities = spacings.map((_, index) => index);
  const [moved] = identities.splice(sourceIndex, 1);
  identities.splice(insertIndex, 0, moved);

  const sourceNext = sourceIndex + 1;
  if (sourceNext < spacings.length) {
    next[sourceNext] = sourceIndex === 0
      ? 'none'
      : largerProjectStackSpacing(spacings[sourceIndex], spacings[sourceNext]);
  }

  if (insertIndex === 0) {
    next[sourceIndex] = 'none';
    const destinationNext = identities[1];
    if (destinationNext !== undefined) next[destinationNext] = 'related';
  } else {
    next[sourceIndex] = 'related';
  }

  return next;
}

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
