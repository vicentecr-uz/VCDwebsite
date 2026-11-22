import { expect, test } from 'bun:test';
import {
  childrenOf, classTokens, cssRules, hasClass, inlineStyle, read, rel, sourceFiles, subjects, tagAt,
} from './lib/devChromeSource';

const OWNER_FILES = [/^src\/components\/ui\//, /^src\/components\/base-ui\//, /^src\/styles\/(dev-chrome|devOverlayFrame|saveBar|global)\.css$/];
const isOwner = (file: string) => OWNER_FILES.some((pattern) => pattern.test(file));

const SPACING = /^(padding|gap|row-gap|column-gap|border(-(top|bottom|start|end)-(left|right|start|end))?-radius)(-|$)/;
const SPACING_AND_MARGIN = /^(padding|margin|gap|row-gap|column-gap|border(-(top|bottom|start|end)-(left|right|start|end))?-radius)(-|$)/;

const OWNED: Array<{ component: string; classes: string[]; props: RegExp }> = [
  { component: 'Menu', classes: ['dev-menu', 'dev-menu__item'], props: SPACING },
  { component: 'DevOverlay', classes: ['dev-overlay', 'dev-overlay__head', 'dev-overlay__body'], props: SPACING },
  { component: 'DevPanel', classes: ['dev-panel', 'dev-panel__header', 'dev-panel__body'], props: SPACING },
  { component: 'Field', classes: ['dev-field', 'dev-field__label-row', 'dev-field__value', 'dev-field__input', 'dev-text-field', 'dev-range-field'], props: SPACING },
  { component: 'PanelActions', classes: ['dev-panel-actions'], props: SPACING },
  { component: 'SegmentedControl', classes: ['dev-segmented'], props: SPACING },
  { component: 'Hairline', classes: ['dev-hairline'], props: SPACING_AND_MARGIN },
  { component: 'ToggleRow', classes: ['dev-toggle'], props: SPACING },
  { component: 'SaveBar', classes: ['dev-text-actions', 'dev-text-actions__surface'], props: SPACING },
  { component: 'Button', classes: ['dev-btn'], props: SPACING },
  { component: 'Badge', classes: ['dev-badge'], props: SPACING },
  { component: 'Keycap', classes: ['dev-keycap'], props: SPACING },
];

const TAG_OWNER: Record<string, string> = {
  Menu: 'Menu', DevOverlay: 'DevOverlay', DevOverlayFrame: 'DevOverlay', DevPanel: 'DevPanel',
  Field: 'Field', RangeField: 'Field', TextField: 'Field', TextArea: 'Field', EditorSelectField: 'Field', SelectField: 'Field',
  PanelActions: 'PanelActions', SegmentedControl: 'SegmentedControl', ViewportSelector: 'SegmentedControl',
  Hairline: 'Hairline', ToggleRow: 'ToggleRow', SaveBar: 'SaveBar', Button: 'Button', Badge: 'Badge', Keycap: 'Keycap',
};

const OWNED_TOKEN = /^--dev-(menu-|panel-pad$|panel-gap$|panel-spacing$|panel-content-gap$|panel-label-gap$|field-padding$|radius-|control-padding$|control-height$)/;

const BASELINE: string[] = [
  'src/components/DevVideoEditor.astro .dev-field__value padding',
  'src/components/project/ProjectImageCaptionTuner.astro .dev-field__value padding',
  'src/components/project/ProjectSignup.astro .dev-field__value padding',
  'src/components/project/ProjectSignup.astro .dev-field__input padding',
  'src/components/DevProjectGridEditor.astro .dev-field__input padding',
  'src/components/project/ProjectSignup.astro .dev-field__value border-radius',
  'src/components/project/ProjectSignup.astro .dev-field__value:has(input:focus-visible)::after border-radius',
  'src/components/DevViewportPreview.astro .dev-segmented padding',
  'src/components/DevViewportPreview.astro .dev-segmented gap',
  'src/components/project/demos/sabi-stage.css .dev-btn padding',
  'src/components/project/demos/sabi-stage.css .dev-btn border-radius',
  'src/components/project/demos/sabi-stage.css .dev-btn padding-inline',
  'src/components/project/demos/sabi-stage.css --dev-control-padding',
  'src/components/project/ProjectAward.astro .dev-btn padding',
  'src/components/reports/InheritedValues.astro .dev-btn gap',
  'src/components/reports/InheritedValues.astro .inherited__reset padding',
  'src/components/reports/ChangeLedger.astro .ledger__count gap',
  'src/components/Header.astro .header-menu__edit-link padding',
  'src/components/Header.astro --dev-control-height',
  'src/styles/project.css .project-details__actions padding',
  'src/components/project/demos/ProgressiveImageDemo.astro .image-quality-badge padding',
];

const astroFiles = () => sourceFiles(undefined, /\.astro$/);
const styleFiles = () => sourceFiles(undefined, /\.(astro|css)$/);

type Offence = { key: string; message: string };

const ownershipOffences = (astro = astroFiles(), styles = styleFiles()): Offence[] => {
  const owned = new Map<string, { component: string; props: RegExp }>();
  OWNED.forEach(({ component, classes, props }) => classes.forEach((name) => owned.set(name, { component, props })));

  const offences: Offence[] = [];
  for (const absolute of astro) {
    const file = rel(absolute);
    if (isOwner(file)) continue;
    const source = read(absolute);
    for (const match of source.matchAll(new RegExp(`<(${Object.keys(TAG_OWNER).join('|')})\\b`, 'g'))) {
      const tag = tagAt(source, match.index!);
      const component = TAG_OWNER[match[1]];
      const { props } = OWNED.find((entry) => entry.component === component)!;
      for (const token of classTokens(tag)) {
        if (!token.startsWith('dev-') && !token.startsWith('is-') && !owned.has(token)) owned.set(token, { component, props });
      }
      const line = source.slice(0, match.index!).split('\n').length;
      inlineStyle(tag).split(';').map((d) => d.split(':')[0].trim().toLowerCase()).filter((prop) => props.test(prop)).forEach((prop) => {
        offences.push({ key: `${file} <${match[1]}> ${prop}`, message: `${file}:${line} — style="${prop}…" on <${match[1]}>; ${component} owns ${prop}` });
      });
      classTokens(tag).filter((token) => /^-?(p[xytrblse]?|gap(-[xy])?|rounded(-\w+)?)-/.test(token)).forEach((token) => {
        offences.push({ key: `${file} <${match[1]}> ${token}`, message: `${file}:${line} — utility class ${token} on <${match[1]}>; ${component} owns its spacing and radius` });
      });
    }
  }

  for (const rule of styles.flatMap(cssRules)) {
    if (isOwner(rule.file)) continue;
    for (const [prop, value] of rule.declarations) {
      if (OWNED_TOKEN.test(prop)) offences.push({ key: `${rule.file} ${prop}`, message: `${rule.file}:${rule.line} — sets ${prop}: ${value}; that token belongs to src/styles/global.css and the ui components` });
    }
    for (const { subject } of subjects(rule.selectors)) {
      for (const [name, { component, props }] of owned) {
        if (!hasClass(subject, name)) continue;
        for (const [prop, value] of rule.declarations) {
          if (!props.test(prop)) continue;
          offences.push({ key: `${rule.file} ${subject} ${prop}`, message: `${rule.file}:${rule.line} — ${subject} { ${prop}: ${value} } overrides ${component}; change the component instead` });
        }
      }
    }
  }
  return offences;
};

test('call sites do not override spacing, gap or radius a ui component owns', () => {
  const offenders = ownershipOffences().filter((offence) => !BASELINE.includes(offence.key)).map((offence) => offence.message);
  expect(offenders).toEqual([]);
});

test('every baseline entry still matches an override', () => {
  const keys = new Set(ownershipOffences().map((offence) => offence.key));
  expect(BASELINE.filter((entry) => !keys.has(entry))).toEqual([]);
});

const INSET = /^(padding|margin)(-|$)/;
const BOTTOM = /^(padding|margin)(-bottom|-block(-end)?)?$/;
const isZero = (value: string) => /^0(px|em|rem)?$/.test(value.trim());

const panelRootOffences = (astro = astroFiles(), styles = styleFiles()) => {
  const offences: string[] = [];
  const roots = new Map<string, string>();
  for (const absolute of astro) {
    for (const child of [...childrenOf(absolute, 'DevOverlay'), ...childrenOf(absolute, 'DevOverlayFrame')]) {
      if (/\bslot=/.test(child.text) || !/^[a-z]/.test(child.name)) continue;
      const where = `${child.file}:${child.line}`;
      classTokens(child.text).forEach((token) => roots.set(`.${token}`, where));
      [...child.text.matchAll(/\s(data-[\w-]+)/g)].forEach((m) => roots.set(`[${m[1]}`, where));
      inlineStyle(child.text).split(';').map((d) => d.split(':')).filter(([prop, value]) => INSET.test(prop.trim()) && !isZero(value ?? ''))
        .forEach(([prop]) => offences.push(`${where} — panel content sets style="${prop.trim()}"; DevOverlay owns the inset`));
      classTokens(child.text).filter((token) => /^-?(p|m)[xytrblse]?-/.test(token))
        .forEach((token) => offences.push(`${where} — panel content has ${token}; DevOverlay owns the inset`));
    }
  }
  const matchesRoot = (compound: string, token: string) => token.startsWith('.') ? hasClass(compound, token.slice(1)) : compound.includes(token);
  for (const rule of styles.flatMap(cssRules)) {
    for (const { selector, subject } of subjects(rule.selectors)) {
      for (const [token, where] of roots) {
        const onRoot = matchesRoot(subject, token);
        const onLastChild = !onRoot && selector.includes(token) && /:last-(child|of-type)/.test(subject);
        if (!onRoot && !onLastChild) continue;
        for (const [prop, value] of rule.declarations) {
          if (isZero(value) || !(onRoot ? INSET : BOTTOM).test(prop)) continue;
          offences.push(`${rule.file}:${rule.line} — ${subject} { ${prop}: ${value} } on DevOverlay content (${where}); DevOverlay owns the inset`);
        }
      }
    }
  }
  return offences;
};

test('DevOverlay content does not set its own outer or bottom inset', () => {
  expect(panelRootOffences()).toEqual([]);
});

test('the guards catch a sample override', () => {
  expect(subjects(':global(.panel .dev-menu.is-open), .a > .b')[0].subject).toBe('.dev-menu.is-open');
  expect(hasClass('.dev-menu.is-open', 'dev-menu')).toBe(true);
  expect(hasClass('.dev-menu__item', 'dev-menu')).toBe(false);
  expect(classTokens('<div class:list={["log-panel", open && "is-open"]} data-x>')).toEqual(['log-panel', 'is-open']);
  const fixture = import.meta.dir + '/fixtures/dev-chrome-ownership.astro';
  expect(childrenOf(fixture, 'DevOverlay').map((tag) => tag.name)).toEqual(['Button', 'div', 'p']);
  expect(panelRootOffences([fixture], [fixture])).toEqual([
    'scripts/test/fixtures/dev-chrome-ownership.astro:11 — .log-panel { padding-bottom: 12px } on DevOverlay content (scripts/test/fixtures/dev-chrome-ownership.astro:3); DevOverlay owns the inset',
  ]);
  expect(ownershipOffences([fixture], [fixture]).map((offence) => offence.key)).toEqual([
    'scripts/test/fixtures/dev-chrome-ownership.astro .dev-menu gap',
  ]);
});
