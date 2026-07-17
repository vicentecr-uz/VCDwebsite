/** Vertical rhythm between project page sections (parent-owned stack). */
export type ProjectStackSpacing = 'related' | 'section' | 'major' | 'none';

export function projectStackClass(
  spacing: ProjectStackSpacing = 'section',
  options?: { precedeRelated?: boolean; flush?: boolean },
): string {
  const classes: string[] = [];
  if (spacing === 'related') classes.push('project-stack--related');
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
