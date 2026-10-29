import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ImageVariants } from './responsiveImage';
import { EMPTY_COVER_FILL } from './placeholderCover.mjs';
import { validateContentVersion, validatePageDocument, validateProjectDocument, type StylesExamples } from './content-schema';
import type { ProjectStackSpacing } from './projectStack';

export type ProjectStatus = 'published' | 'draft' | 'teaser' | 'image';
export type ProjectStack = 'modern' | 'legacy';

export type ProjectListingCard = {
  order?: number;
  year?: string;
  meta?: string;
  image: string;
  /** In-context shot shown on card hover (desktop). */
  hoverImage?: string;
  /** Title-region light/dark for `hoverImage`, measured at drop time (#182). Absent falls back to `dark`. */
  hoverDark?: boolean;
  bg: string;
  dark: boolean;
  full?: boolean;
  /** Override card link (e.g. Design System → /styles). */
  href?: string;
  /** Per-viewport cover crop (same shape as project image variants). */
  variants?: ImageVariants;
  /** Per-viewport hover composition — aspect linked to cover; pan/zoom independent. */
  hoverVariants?: ImageVariants;
  srcWidth?: number;
  srcHeight?: number;
  mobileInset?: boolean;
};

export type ProjectTeaserConfig = {
  label?: string;
  coverImage?: string;
};

export type ProjectDocument = {
  slug: string;
  title: string;
  description?: string;
  status?: ProjectStatus;
  stack?: ProjectStack;
  listings?: Partial<Record<'home' | 'play', ProjectListingCard>>;
  teaser?: ProjectTeaserConfig;
  trailingSpacing?: ProjectStackSpacing;
  scrollFinale?: boolean;
  outline?: Array<Record<string, unknown>>;
  sections: Array<Record<string, unknown>>;
};

export type ProjectGridListing = {
  slug: string;
  title: string;
  subtitle?: string;
  image: string;
  hoverImage?: string;
  hoverDark?: boolean;
  bg: string;
  dark: boolean;
  full?: boolean;
  href?: string;
  status: ProjectStatus;
  teaser?: boolean;
  teaserLabel?: string;
  order?: number;
  variants?: ImageVariants;
  hoverVariants?: ImageVariants;
  srcWidth?: number;
  srcHeight?: number;
  mobileInset?: boolean;
};

const projectModules = import.meta.glob<{ default: ProjectDocument }>(
  '../content/projects/*.json',
  { eager: true },
);

export type PageDocumentKey = 'home' | 'home-intro' | 'play' | 'about' | 'styles' | 'analytics';

export type PageDocument = {
  examples?: StylesExamples;
  title?: string;
  description?: string;
  subtitle?: string;
  introHeight?: number;
  introParagraphs?: string[];
  trailingSpacing?: ProjectStackSpacing;
  sections: Array<Record<string, unknown>>;
  outline?: Array<Record<string, unknown>>;
};

const pageModules = import.meta.glob<{ default: PageDocument }>(
  '../content/pages/*.json',
  { eager: true },
);

const versionModules = import.meta.glob<{ default: unknown }>('../content/settings/schema.json', { eager: true });
const versionPath = 'src/content/settings/schema.json';

function readDocument(file: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path.join(process.cwd(), file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file}: invalid JSON`, { cause: error });
  }
}

function validateVersion(): void {
  validateContentVersion(import.meta.env.DEV
    ? readDocument(versionPath)
    : versionModules['../content/settings/schema.json']?.default, versionPath);
}

if (import.meta.env.PROD) {
  validateVersion();
  for (const [file, module] of Object.entries(projectModules)) {
    validateProjectDocument(module.default, file.replace('../', 'src/'));
  }
  for (const [file, module] of Object.entries(pageModules)) {
    validatePageDocument(module.default, file.replace('../', 'src/'));
  }
}

function projectPathToSlug(filePath: string): string {
  return filePath.replace('../content/projects/', '').replace('.json', '');
}

function normalizeProject(slug: string, doc: ProjectDocument): ProjectDocument {
  validateProjectDocument(doc, `src/content/projects/${slug}.json`);
  return {
    ...doc,
    slug: doc.slug ?? slug,
    status: doc.status ?? 'published',
    stack: doc.stack ?? 'modern',
  };
}

/** Dev SSR must bypass Vite's eager JSON glob — HMR gate keeps it stale after API writes. */
function loadProjectFromDisk(slug: string): ProjectDocument | undefined {
  if (!import.meta.env.DEV) return undefined;
  validateVersion();
  const doc = readDocument(`src/content/projects/${slug}.json`);
  return doc === undefined ? undefined : normalizeProject(slug, doc as ProjectDocument);
}

/** Dev must read JSON from disk — the eager glob stays stale after writes / stack changes. */
function loadAllProjectsFromDisk(): ProjectDocument[] {
  validateVersion();
  const dir = path.join(process.cwd(), 'src/content/projects');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json') && !file.endsWith('-old.json'))
    .map((file) => {
      const slug = file.replace(/\.json$/, '');
      const doc = readDocument(`src/content/projects/${file}`) as ProjectDocument;
      return normalizeProject(slug, doc);
    });
}

export function loadAllProjects(): ProjectDocument[] {
  if (import.meta.env.DEV) {
    return loadAllProjectsFromDisk();
  }
  return Object.entries(projectModules)
    .filter(([filePath]) => !filePath.endsWith('-old.json'))
    .map(([filePath, module]) => normalizeProject(projectPathToSlug(filePath), module.default));
}

export function loadProjectBySlug(slug: string): ProjectDocument | undefined {
  return loadProjectFromDisk(slug) ?? loadAllProjects().find((project) => project.slug === slug);
}

/** Dev SSR must bypass Vite's eager JSON glob — HMR gate keeps it stale after API writes. */
function loadPageFromDisk(key: PageDocumentKey): PageDocument | undefined {
  if (!import.meta.env.DEV) return undefined;
  validateVersion();
  const file = `src/content/pages/${key}.json`;
  const doc = readDocument(file);
  return doc === undefined ? undefined : validatePageDocument(doc, file) as PageDocument;
}

export function loadPageDocument(key: PageDocumentKey): PageDocument {
  if (import.meta.env.DEV) return loadPageFromDisk(key) ?? { sections: [] };
  const module = pageModules[`../content/pages/${key}.json`];
  return module?.default ?? { sections: [] };
}

export function shouldIncludeProjectInBuild(
  project: ProjectDocument,
  options: { dev?: boolean } = {},
): boolean {
  const dev = options.dev ?? import.meta.env.DEV;
  const status = project.status ?? 'published';
  // Image is gallery-only — no `/slug` route even in dev (#287).
  if (status === 'image') return false;
  // Dev: every other modern project is routable so authors can open teasers/drafts.
  // Production: only Public (`published`). Teaser cards still appear on galleries
  // (unclickable); their `/slug` must not exist — same non-discovery as draft (#192).
  if (dev) return true;
  return status === 'published';
}

export function getProjectSlugsForBuild(options: { dev?: boolean } = {}): string[] {
  return loadAllProjects()
    .filter((project) => shouldIncludeProjectInBuild(project, options))
    .map((project) => project.slug);
}

function listingCardForGrid(
  project: ProjectDocument,
  listing: ProjectListingCard,
  grid: 'home' | 'play',
): ProjectGridListing | undefined {
  const dev = import.meta.env.DEV;
  const status = project.status ?? 'published';

  if (!dev && status === 'draft') return undefined;

  const isTeaser = status === 'teaser';
  const isImage = status === 'image';
  const image = isTeaser
    ? (project.teaser?.coverImage ?? listing.image)
    : listing.image;

  const defaultHref = listing.href ?? `/${project.slug}`;

  return {
    slug: project.slug,
    title: project.title,
    subtitle: grid === 'play' ? listing.meta : listing.year,
    image,
    hoverImage: listing.hoverImage,
    hoverDark: listing.hoverDark,
    bg: listing.bg,
    dark: listing.dark,
    full: listing.full,
    href: isImage ? undefined : (isTeaser && !dev ? undefined : defaultHref),
    status,
    teaser: isTeaser,
    teaserLabel: project.teaser?.label ?? 'Coming soon',
    order: listing.order,
    variants: listing.variants,
    hoverVariants: listing.hoverVariants,
    srcWidth: listing.srcWidth,
    srcHeight: listing.srcHeight,
    mobileInset: listing.mobileInset,
  };
}

export function getProjectGridListings(grid: 'home' | 'play'): ProjectGridListing[] {
  const projects = loadAllProjects();
  const listings: ProjectGridListing[] = [];

  for (const project of projects) {
    const listing = project.listings?.[grid];
    if (!listing) continue;
    const item = listingCardForGrid(project, listing, grid);
    if (item) listings.push(item);
  }

  return listings.sort((a, b) => {
    const projectA = projects.find((item) => item.slug === a.slug);
    const projectB = projects.find((item) => item.slug === b.slug);
    const orderA = projectA?.listings?.[grid]?.order ?? 999;
    const orderB = projectB?.listings?.[grid]?.order ?? 999;
    return orderA - orderB;
  });
}

export function emptyModernProjectDocument(
  slug: string,
  title: string,
  grid: 'home' | 'play',
): ProjectDocument {
  return {
    slug,
    title,
    description: '',
    status: 'draft',
    stack: 'modern',
    listings: {
      [grid]: grid === 'play'
        ? {
            order: 999,
            meta: '',
            image: '',
            bg: EMPTY_COVER_FILL,
            dark: true,
            full: false,
          }
        : {
            order: 999,
            year: new Date().getFullYear().toString().slice(-2).padStart(2, "'"),
            image: '',
            bg: EMPTY_COVER_FILL,
            dark: true,
            full: false,
          },
    },
    outline: [],
    sections: [
      {
        type: 'bodyText',
        id: 'body-1',
        spacing: 'none',
        paragraphs: [''],
      },
    ],
  };
}

export function getEditableProjectDocuments(): Map<string, string> {
  const map = new Map<string, string>();
  for (const project of loadAllProjects()) {
    map.set(project.slug, `src/content/projects/${project.slug}.json`);
  }
  map.set('styles', 'src/content/pages/styles.json');
  return map;
}
