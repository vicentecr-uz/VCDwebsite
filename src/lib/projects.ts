import { loadViewConfig, getActiveViewId, isViewBuild, type SiteViewConfig } from './views';

export type ProjectStatus = 'published' | 'draft' | 'teaser' | 'view-only';
export type ProjectStack = 'modern' | 'legacy';

export type ProjectListingCard = {
  order?: number;
  year?: string;
  meta?: string;
  image: string;
  bg: string;
  dark: boolean;
  full?: boolean;
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
  bg: string;
  dark: boolean;
  full?: boolean;
  href?: string;
  status: ProjectStatus;
  teaser?: boolean;
  teaserLabel?: string;
  order?: number;
};

export type PlayLinkItem = {
  id: string;
  order?: number;
  title: string;
  meta?: string;
  image: string;
  bg: string;
  dark: boolean;
  href?: string;
};

const projectModules = import.meta.glob<{ default: ProjectDocument }>(
  '../content/projects/*.json',
  { eager: true },
);

const playLinkModules = import.meta.glob<{ default: PlayLinkItem }>(
  '../content/play/*.json',
  { eager: true },
);

function projectPathToSlug(path: string): string {
  return path.replace('../content/projects/', '').replace('.json', '');
}

export function loadAllProjects(): ProjectDocument[] {
  return Object.entries(projectModules)
    .filter(([path]) => !path.endsWith('-old.json'))
    .map(([path, module]) => {
      const slug = projectPathToSlug(path);
      const doc = module.default;
      return {
        ...doc,
        slug: doc.slug ?? slug,
        status: doc.status ?? 'published',
        stack: doc.stack ?? (slug === 'tapico' ? 'modern' : 'legacy'),
      };
    });
}

export function loadProjectBySlug(slug: string): ProjectDocument | undefined {
  return loadAllProjects().find((project) => project.slug === slug);
}

function viewIncludesSlug(view: SiteViewConfig | undefined, slug: string): boolean {
  return Boolean(view?.projects.some((entry) => entry.slug === slug));
}

export function shouldIncludeProjectInBuild(
  project: ProjectDocument,
  options: { dev?: boolean; viewId?: string } = {},
): boolean {
  const dev = options.dev ?? import.meta.env.DEV;
  const view = loadViewConfig(options.viewId);

  if (dev) return true;

  if (isViewBuild() || options.viewId) {
    if (!viewIncludesSlug(view, project.slug)) return false;
    if (project.status === 'draft') return false;
    return true;
  }

  if (project.status === 'draft' || project.status === 'view-only') {
    return false;
  }

  return project.status === 'published' || project.status === 'teaser';
}

export function getModernProjectSlugsForBuild(options: { dev?: boolean; viewId?: string } = {}): string[] {
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
  if (!dev && status === 'view-only' && !isViewBuild()) return undefined;

  const isTeaser = status === 'teaser';
  const image = isTeaser
    ? (project.teaser?.coverImage ?? listing.image)
    : listing.image;

  return {
    slug: project.slug,
    title: project.title,
    subtitle: grid === 'play' ? listing.meta : listing.year,
    image,
    bg: listing.bg,
    dark: listing.dark,
    full: listing.full,
    href: isTeaser && !dev ? undefined : `/${project.slug}`,
    status,
    teaser: isTeaser,
    teaserLabel: project.teaser?.label ?? 'Coming soon',
    order: listing.order,
  };
}

export function getProjectGridListings(grid: 'home' | 'work' | 'play'): ProjectGridListing[] {
  const view = loadViewConfig();
  const projects = loadAllProjects();
  const listings: ProjectGridListing[] = [];

  if (view && (grid === 'home' || grid === 'work')) {
    const ordered = [...view.projects].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    for (const entry of ordered) {
      const project = projects.find((item) => item.slug === entry.slug);
      if (!project) continue;
      const baseListing = project.listings?.[grid];
      if (!baseListing) continue;
      const merged = {
        ...baseListing,
        ...(entry.card ?? {}),
      };
      const item = listingCardForGrid(project, merged, grid);
      if (item) listings.push(item);
    }
    return listings;
  }

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

export function getPlayGridItems(): Array<ProjectGridListing | PlayLinkItem & { isLink: true }> {
  const view = loadViewConfig();
  if (view?.site?.nav && !view.site.nav.includes('play')) {
    return [];
  }

  const projectItems = getProjectGridListings('play');
  const linkItems = Object.entries(playLinkModules)
    .map(([filePath, entry]) => ({
      ...entry.default,
      id: filePath.replace('../content/play/', '').replace(/\.json$/, ''),
      isLink: true as const,
      order: entry.default.order ?? 999,
    }));

  return [...projectItems, ...linkItems].sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999),
  );
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
      [grid]: {
        order: 999,
        year: new Date().getFullYear().toString().slice(-2).padStart(2, "'"),
        image: '/images/black-token.svg',
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
  map.set('the-rams', 'src/content/projects/the-rams.json');
  map.set('parentpal', 'src/content/projects/parentpal.json');
  map.set('conic-collection', 'src/content/projects/conic-collection.json');
  map.set('styles', 'src/content/pages/styles.json');
  return map;
}
