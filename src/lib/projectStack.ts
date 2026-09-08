import {
  PROJECT_STACK_SPACING_VALUES,
  canonicalizeProjectStackSpacing,
  isProjectStackSpacingPath,
  isProjectStackSpacingValue,
  resolveProjectStackSpacing,
  setProjectStackSpacingAtViewport,
} from './projectStackSpacing.js';

/** Vertical rhythm between project page sections (parent-owned stack). */
export type ProjectStackSpacingValue = (typeof PROJECT_STACK_SPACING_VALUES)[number];
export type ProjectStackSpacingViewport = 'desktop' | 'tablet' | 'mobile';
export type ProjectStackSpacing =
  | ProjectStackSpacingValue
  | Partial<Record<ProjectStackSpacingViewport, ProjectStackSpacingValue>>;
export type ProjectStackSpacingResolved = Record<
  ProjectStackSpacingViewport,
  ProjectStackSpacingValue
>;

export type ProjectStackSpacingSnapshotState = {
  document: string;
  currentValue: ProjectStackSpacingResolved;
  visualSavedValue: ProjectStackSpacingResolved;
};

const cloneResolvedSpacing = (value: ProjectStackSpacingResolved): ProjectStackSpacingResolved => ({ ...value });

/** Keeps reorder seam state isolated to one pending document transaction. */
export function createProjectStackSpacingSnapshotStore<T extends ProjectStackSpacingSnapshotState>() {
  const snapshots = new Map<string, Map<T, {
    currentValue: ProjectStackSpacingResolved;
    visualSavedValue: ProjectStackSpacingResolved;
  }>>();
  return {
    capture(document: string, states: readonly T[]) {
      if (snapshots.has(document)) return;
      snapshots.set(document, new Map(states.filter((state) => state.document === document).map((state) => [state, {
        currentValue: cloneResolvedSpacing(state.currentValue),
        visualSavedValue: cloneResolvedSpacing(state.visualSavedValue),
      }])));
    },
    restore(document: string, apply: (state: T, snapshot: {
      currentValue: ProjectStackSpacingResolved;
      visualSavedValue: ProjectStackSpacingResolved;
    }) => void) {
      const snapshot = snapshots.get(document);
      if (!snapshot) return;
      snapshot.forEach((values, state) => apply(state, {
        currentValue: cloneResolvedSpacing(values.currentValue),
        visualSavedValue: cloneResolvedSpacing(values.visualSavedValue),
      }));
      snapshots.delete(document);
    },
    preview(document: string, apply: (state: T, snapshot: {
      currentValue: ProjectStackSpacingResolved;
      visualSavedValue: ProjectStackSpacingResolved;
    }) => void) {
      const snapshot = snapshots.get(document);
      if (!snapshot) return;
      snapshot.forEach((values, state) => apply(state, {
        currentValue: cloneResolvedSpacing(values.currentValue),
        visualSavedValue: cloneResolvedSpacing(values.visualSavedValue),
      }));
    },
    reset(document?: string) {
      if (document) snapshots.delete(document);
      else snapshots.clear();
    },
  };
}

export {
  canonicalizeProjectStackSpacing,
  isProjectStackSpacingPath,
  isProjectStackSpacingValue,
  resolveProjectStackSpacing,
  setProjectStackSpacingAtViewport,
};

const PROJECT_STACK_SPACING_ORDER: Record<ProjectStackSpacingValue, number> = {
  none: 0,
  related: 1,
  group: 2,
  section: 3,
  major: 4,
};

export const shouldKeepLeadingSpacingSeam = (
  leadingSize: number,
  trailingSize: number,
  leadingDirty = false,
  trailingDirty = false,
) => {
  if (leadingSize !== trailingSize) return leadingSize > trailingSize;
  if (leadingDirty !== trailingDirty) return leadingDirty;
  return true;
};

export type ProjectStackSpacingReorder = {
  values: ProjectStackSpacingValue[];
  /** Original seam index supplying each value; null means a generated default seam. */
  origins: Array<number | null>;
};

export type ProjectStackInsertionSide = 'before' | 'after';

/** Values stay with block identities; `destinationSide` chooses which side keeps the authored seam. */
export function reorderProjectStackSpacingSeams(
  spacings: ProjectStackSpacingValue[],
  sourceIndex: number,
  insertIndex: number,
  destinationSide?: ProjectStackInsertionSide,
  dirtySeams: boolean[] = [],
): ProjectStackSpacingReorder {
  const values = [...spacings];
  const origins = spacings.map((_, index) => index as number | null);
  if (
    sourceIndex < 0
    || sourceIndex >= spacings.length
    || insertIndex < 0
    || insertIndex >= spacings.length
    || (sourceIndex === insertIndex && destinationSide === undefined)
  ) {
    return { values, origins };
  }

  const identities = spacings.map((_, index) => index);
  const [moved] = identities.splice(sourceIndex, 1);

  const sourceNext = sourceIndex + 1;
  if (sourceNext < spacings.length) {
    if (sourceIndex === 0) {
      values[sourceNext] = 'none';
      origins[sourceNext] = null;
    } else {
      const winner = shouldKeepLeadingSpacingSeam(
        PROJECT_STACK_SPACING_ORDER[spacings[sourceIndex]],
        PROJECT_STACK_SPACING_ORDER[spacings[sourceNext]],
        dirtySeams[sourceIndex],
        dirtySeams[sourceNext],
      )
        ? sourceIndex
        : sourceNext;
      values[sourceNext] = spacings[winner];
      origins[sourceNext] = winner;
    }
  }

  if (insertIndex === 0) {
    values[moved] = 'none';
    origins[moved] = null;
    const destinationNext = identities[0];
    if (destinationNext !== undefined) {
      values[destinationNext] = 'related';
      origins[destinationNext] = null;
    }
  } else {
    const destinationNext = identities[insertIndex];
    if (destinationNext === undefined) {
      values[moved] = 'related';
      origins[moved] = null;
    } else if (destinationSide === 'before') {
      values[moved] = 'related';
      origins[moved] = null;
    } else {
      values[moved] = values[destinationNext];
      origins[moved] = origins[destinationNext];
      values[destinationNext] = 'related';
      origins[destinationNext] = null;
    }
  }

  return { values, origins };
}

export function reorderProjectStackSpacings(
  spacings: ProjectStackSpacingValue[],
  sourceIndex: number,
  insertIndex: number,
): ProjectStackSpacingValue[] {
  return reorderProjectStackSpacingSeams(spacings, sourceIndex, insertIndex).values;
}

export function projectStackClass(
  spacing: ProjectStackSpacing = 'section',
  options?: { precedeRelated?: boolean; flush?: boolean },
): string {
  const resolved = resolveProjectStackSpacing(spacing);
  const classes: string[] = [];
  classes.push(`project-stack--${resolved.desktop}`);
  if (resolved.tablet !== resolved.desktop) classes.push(`project-stack--tablet-${resolved.tablet}`);
  if (resolved.mobile !== resolved.tablet) classes.push(`project-stack--mobile-${resolved.mobile}`);
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
  options?: { writePath?: Array<string | number> },
): Record<string, string> | undefined {
  if (!import.meta.env.DEV || !documentKey || !sectionPath?.length) return undefined;
  const resolved = resolveProjectStackSpacing(spacing);
  return {
    'data-dev-spacing-document': documentKey,
    'data-dev-spacing-path': JSON.stringify([...sectionPath, 'spacing']),
    'data-dev-spacing-value': resolved.desktop,
    'data-dev-spacing-values': JSON.stringify(resolved),
    ...(options?.writePath ? { 'data-dev-spacing-write-path': JSON.stringify(options.writePath) } : {}),
  };
}
