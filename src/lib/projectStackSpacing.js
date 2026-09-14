// @ts-check

export const PROJECT_STACK_SPACING_VALUES = /** @type {const} */ ([
  'related',
  'group',
  'section',
  'major',
  'none',
]);

/** @typedef {(typeof PROJECT_STACK_SPACING_VALUES)[number]} ProjectStackSpacingValue */
/** @typedef {'desktop' | 'tablet' | 'mobile'} ProjectStackSpacingViewport */
/** @typedef {Partial<Record<ProjectStackSpacingViewport, ProjectStackSpacingValue>>} ProjectStackSpacingMap */
/** @typedef {Record<ProjectStackSpacingViewport, ProjectStackSpacingValue>} ProjectStackSpacingResolved */

const PROJECT_STACK_SPACING_SET = new Set(PROJECT_STACK_SPACING_VALUES);

/**
 * @param {unknown} path
 * @returns {path is Array<string | number>}
 */
export const isProjectStackSpacingPath = (path) => (
  Array.isArray(path) && (
    (path.length === 1 && path[0] === 'trailingSpacing')
    || (path.length >= 2 && path.at(-1) === 'spacing')
  )
);

/**
 * @param {unknown} value
 * @returns {value is ProjectStackSpacingValue}
 */
export const isProjectStackSpacingValue = (value) => (
  typeof value === 'string' && PROJECT_STACK_SPACING_SET.has(/** @type {ProjectStackSpacingValue} */ (value))
);

/**
 * @param {unknown} [spacing]
 * @returns {ProjectStackSpacingResolved}
 */
export const resolveProjectStackSpacing = (spacing) => {
  const source = spacing && typeof spacing === 'object' && !Array.isArray(spacing)
    ? /** @type {Record<string, unknown>} */ (spacing)
    : {};
  const desktop = isProjectStackSpacingValue(spacing)
    ? spacing
    : isProjectStackSpacingValue(source.desktop) ? source.desktop : 'group';
  const tablet = isProjectStackSpacingValue(source.tablet) ? source.tablet : desktop;
  const mobile = isProjectStackSpacingValue(source.mobile) ? source.mobile : tablet;
  return { desktop, tablet, mobile };
};

/**
 * @param {ProjectStackSpacingResolved} current
 * @param {ProjectStackSpacingViewport} viewport
 * @param {ProjectStackSpacingValue} nextValue
 * @returns {ProjectStackSpacingResolved}
 */
export const setProjectStackSpacingAtViewport = (current, viewport, nextValue) => {
  const next = { ...current };
  if (viewport === 'desktop') {
    next.desktop = nextValue;
    next.tablet = nextValue;
    next.mobile = nextValue;
  } else if (viewport === 'tablet') {
    next.tablet = nextValue;
    next.mobile = nextValue;
  } else {
    next.mobile = nextValue;
  }
  return next;
};

/**
 * @param {unknown} value
 * @returns {ProjectStackSpacingValue | ProjectStackSpacingMap}
 */
export const canonicalizeProjectStackSpacing = (value) => {
  if (isProjectStackSpacingValue(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid spacing value.');
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(source);
  if (!keys.length || keys.some((key) => !['desktop', 'tablet', 'mobile'].includes(key))) {
    throw new Error('Invalid spacing viewport.');
  }
  if (keys.some((key) => !isProjectStackSpacingValue(source[key]))) {
    throw new Error('Invalid spacing value.');
  }
  const resolved = resolveProjectStackSpacing(source);
  if (resolved.desktop === resolved.tablet && resolved.tablet === resolved.mobile) {
    return resolved.desktop;
  }
  /** @type {ProjectStackSpacingMap} */
  const canonical = { desktop: resolved.desktop };
  if (resolved.tablet !== resolved.desktop) canonical.tablet = resolved.tablet;
  if (resolved.mobile !== resolved.tablet) canonical.mobile = resolved.mobile;
  return canonical;
};
