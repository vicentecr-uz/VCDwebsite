import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ImageVariants } from './responsiveImage';

export type ProjectStatus = 'published' | 'draft' | 'teaser';
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
  listings?: Partial<Record<'home' | 'work' | 'play', ProjectListingCard>>;
  teaser?: ProjectTeaserConfig;
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
};

const projectModules = import.meta.glob<{ default: ProjectDocument }>(
  '../content/projects/*.json',
  { eager: true },
);

function projectPathToSlug(filePath: string): string {
  return filePath.replace('../content/projects/', '').replace('.json', '');
}

function normalizeProject(slug: string, doc: ProjectDocument): ProjectDocument {
  return {
    ...doc,
    slug: doc.slug ?? slug,
    status: doc.status ?? 'published',
    stack: doc.stack ?? (slug === 'tapico' ? 'modern' : 'legacy'),
  };
}

/** Dev SSR must bypass Vite's eager JSON glob — HMR gate keeps it stale after API writes. */
function loadProjectFromDisk(slug: string): ProjectDocument | undefined {
  if (!import.meta.env.DEV) return undefined;
  try {
    const file = path.join(process.cwd(), 'src/content/projects', `${slug}.json`);
    const doc = JSON.parse(readFileSync(file, 'utf8')) as ProjectDocument;
    return normalizeProject(slug, doc);
  } catch {
    return undefined;
  }
}

/** Dev must read JSON from disk — the eager glob stays stale after writes / stack changes. */
function loadAllProjectsFromDisk(): ProjectDocument[] {
  const dir = path.join(process.cwd(), 'src/content/projects');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json') && !file.endsWith('-old.json'))
    .map((file) => {
      const slug = file.replace(/\.json$/, '');
      const doc = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as ProjectDocument;
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

export function shouldIncludeProjectInBuild(
  project: ProjectDocument,
  options: { dev?: boolean } = {},
): boolean {
  const dev = options.dev ?? import.meta.env.DEV;
  // Dev: every modern project is routable so authors can open teasers/drafts.
  // Production: only Public (`published`). Teaser cards still appear on galleries
  // (unclickable); their `/slug` must not exist — same non-discovery as draft (#192).
  if (dev) return true;
  return (project.status ?? 'published') === 'published';
}

export function getModernProjectSlugsForBuild(options: { dev?: boolean } = {}): string[] {
  return loadAllProjects()
    .filter((project) => project.stack === 'modern')
    .filter((project) => shouldIncludeProjectInBuild(project, options))
    .map((project) => project.slug);
}

function listingCardForGrid(
  project: ProjectDocument,
  listing: ProjectListingCard,
  grid: 'home' | 'work' | 'play',
): ProjectGridListing | undefined {
  const dev = import.meta.env.DEV;
  const status = project.status ?? 'published';

  if (!dev && status === 'draft') return undefined;

  const isTeaser = status === 'teaser';
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
    href: isTeaser && !dev ? undefined : defaultHref,
    status,
    teaser: isTeaser,
    teaserLabel: project.teaser?.label ?? 'Coming soon',
    order: listing.order,
    variants: listing.variants,
    hoverVariants: listing.hoverVariants,
    srcWidth: listing.srcWidth,
    srcHeight: listing.srcHeight,
  };
}

export function getProjectGridListings(grid: 'home' | 'work' | 'play'): ProjectGridListing[] {
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
  grid: 'home' | 'work' | 'play',
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
            image: 'black-token.svg',
            bg: '#efefef',
            dark: false,
            full: false,
          }
        : {
            order: 999,
            year: new Date().getFullYear().toString().slice(-2).padStart(2, "'"),
            image: 'black-token.svg',
            bg: '#efefef',
            dark: false,
            full: false,
          },
    },
    outline: [
      {
        kind: 'section',
        id: 'overview',
        label: 'Overview',
        anchor: 'overview',
      },
    ],
    sections: [
      {
        type: 'sectionTitle',
        id: 'overview-title',
        title,
        spacing: 'section',
        sectionId: 'overview',
      },
      {
        type: 'bodyText',
        id: 'overview-body',
        spacing: 'section',
        sectionId: 'overview',
        paragraphs: [''],
      },
    ],
  };
}

export function getEditableProjectDocuments(): Map<string, string> {
  const map = new Map<string, string>();
  for (const project of loadAllProjects()) {
    if (project.stack === 'modern' || project.slug === 'tapico') {
      map.set(project.slug, `src/content/projects/${project.slug}.json`);
    }
  }
  map.set('[retired-project]', 'src/content/projects/[retired-project].json');
  map.set('[retired-project]', 'src/content/projects/[retired-project].json');
  map.set('parentpal', 'src/content/projects/parentpal.json');
  map.set('conic-collection', 'src/content/projects/conic-collection.json');
  map.set('styles', 'src/content/pages/styles.json');
  return map;
}
