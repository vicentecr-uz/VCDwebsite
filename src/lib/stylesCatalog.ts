import type { loadPageDocument } from './projects';

type ComponentCategory = 'site' | 'project-shell' | 'project-content' | 'project-media' | 'ui-primitives';

type PreviewKey =
  | 'header'
  | 'footer'
  | 'documentation-layout'
  | 'documentation-contents'
  | 'sidebar-nav'
  | 'project-grid'
  | 'project-layout'
  | 'image-lead'
  | 'divider'
  | 'body-text'
  | 'section-title'
  | 'image-grid'
  | 'press-quote-ticker'
  | 'reddit-comment-carousel'
  | 'video'
  | 'ui-button'
  | 'ui-menu'
  | 'ui-segmented-control'
  | 'ui-dev-panel'
  | 'ui-dev-panel-title'
  | 'ui-field'
  | 'ui-text-field'
  | 'ui-text-area'
  | 'ui-select-field'
  | 'ui-toggle-row'
  | 'ui-panel-actions'
  | 'ui-badge'
  | 'ui-hairline'
  | 'ui-viewport-selector'
  | 'project-award'
  | 'project-details';

type ComponentEntry = {
  id: string;
  name: string;
  category: ComponentCategory;
  purpose: string;
  classRef: string;
  source: string;
  props: string;
  usedOn: string[];
  preview: PreviewKey;
};

export const categoryLabels: Record<ComponentCategory, string> = {
  site: 'Site chrome',
  'project-shell': 'Project shell',
  'project-content': 'Project content',
  'project-media': 'Project media',
  'ui-primitives': 'UI primitives',
};

export function stylesComponents(examples: NonNullable<ReturnType<typeof loadPageDocument>['examples']>): ComponentEntry[] {
  return [
  {
    id: 'component-documentation-layout', name: 'DocumentationLayout', category: 'project-shell',
    purpose: 'Documentation template with product navigation, editable page blocks and section contents.',
    classRef: '.documentation-page', source: 'src/layouts/DocumentationLayout.astro',
    props: 'title, description?, product?, homeHref?, pages[], contents[], previous?, next?',
    usedOn: ['/sabi/introduction', '/sabi/api', '/sabi/styling'], preview: 'documentation-layout',
  },
  {
    id: 'component-documentation-contents', name: 'DocumentationContents', category: 'site',
    purpose: 'On this page navigation with native section anchors.',
    classRef: '.documentation-contents', source: 'src/components/DocumentationContents.astro',
    props: 'contents[]', usedOn: ['/sabi/introduction', '/sabi/api', '/sabi/styling'], preview: 'documentation-contents',
  },
  {
    id: 'component-header',
    name: 'Header',
    category: 'site',
    purpose: 'Global nav, wordmark swap on inner pages, menu overlay.',
    classRef: '.site-header / .site-header--nav-menu',
    source: 'src/components/Header.astro',
    props: 'title?, navMenu? (default true)',
    usedOn: ['All pages'],
    preview: 'header',
  },
  {
    id: 'component-footer',
    name: 'Footer',
    category: 'site',
    purpose: 'Copyright line anchored to page bottom.',
    classRef: '.footer-text',
    source: 'src/components/Footer.astro',
    props: '(none)',
    usedOn: ['All pages'],
    preview: 'footer',
  },
  {
    id: 'component-section-sidebar-nav',
    name: 'SectionSidebarNav',
    category: 'site',
    purpose: 'Scroll-spy section nav for long single-column pages.',
    classRef: '.section-sidebar-nav',
    source: 'src/components/SectionSidebarNav.astro',
    props: 'sectionLinks, ariaLabel?, enableEasingDevPanel?',
    usedOn: ['/styles', '/about', examples.referenceProject.href],
    preview: 'sidebar-nav',
  },
  {
    id: 'component-project-grid',
    name: 'ProjectGrid',
    category: 'site',
    purpose: 'Project/play listing grid on Home and Play — cover cards with hover title reveal and optional cover→hover image fade.',
    classRef: '.project-grid / .project-grid__card / .project-grid__cover',
    source: 'src/components/ProjectGrid.astro',
    props: 'items[] (title, image, hoverImage?, bg, dark, subtitle?, href?, full?), variant? (home | play)',
    usedOn: ['Home', 'Play'],
    preview: 'project-grid',
  },
  {
    id: 'component-project-layout',
    name: 'ProjectLayout',
    category: 'project-shell',
    purpose: 'Case-study page shell: Layout + Header + main slot + Footer + project.css.',
    classRef: '.project-page / .project-page__main',
    source: 'src/components/ProjectLayout.astro',
    props: 'title, description, outline?, sectionLinks?, sectionNavDocument?',
    usedOn: [examples.referenceProject.title],
    preview: 'project-layout',
  },
  {
    id: 'component-project-image',
    name: 'ProjectImage',
    category: 'project-media',
    purpose: 'Single project image — lead/crop (variant) or inline media between prose, with optional captions (overlay or below-image).',
    classRef: '.project-image / .project-media',
    source: 'src/components/project/ProjectImage.astro',
    props: 'src, alt?, kind? (lead | inline), variants?, caption?, captions?, captionReveal?, captionStyle?, captionPosition?, constrained?, maxVh?, spacing?',
    usedOn: [examples.referenceProject.title],
    preview: 'image-lead',
  },
  {
    id: 'component-project-image-grid',
    name: 'ProjectImageGrid',
    category: 'project-media',
    purpose: 'Responsive multi-image grid with per-cell crop and captions.',
    classRef: '.project-image-grid / .project-image-grid__item',
    source: 'src/components/project/ProjectImageGrid.astro',
    props: 'items[], columns?, defaultAspectRatio?, matchHeight?, constrained?, layouts?, document?, basePath?, spacing?',
    usedOn: [examples.referenceProject.title],
    preview: 'image-grid',
  },
  {
    id: 'component-project-award',
    name: 'ProjectAward',
    category: 'project-content',
    purpose: 'Centered award badge with a link.',
    classRef: '.project-award',
    source: 'src/components/project/ProjectAward.astro',
    props: 'src?, alt?, href?, spacing?',
    usedOn: [],
    preview: 'project-award',
  },
  {
    id: 'component-project-divider',
    name: 'ProjectDivider',
    category: 'project-content',
    purpose: 'An independent hairline divider with editable spacing and block order.',
    classRef: '.project-divider',
    source: 'src/components/project/ProjectDivider.astro',
    props: 'documentKey?, sectionPath?, spacing?, sectionId?, contentId?',
    usedOn: ['Sabi API', 'Sabi Styling', 'Project details'],
    preview: 'divider',
  },
  {
    id: 'component-project-details',
    name: 'ProjectDetails',
    category: 'project-content',
    purpose: 'Project metadata and credits, with editable label/value rows.',
    classRef: '.project-details',
    source: 'src/components/project/ProjectDetails.astro',
    props: 'title, rows, spacing?',
    usedOn: [],
    preview: 'project-details',
  },
  {
    id: 'component-project-body-text',
    name: 'ProjectBodyText',
    category: 'project-content',
    purpose: 'Narrative body copy between media blocks.',
    classRef: '.project-body-text / .project-block',
    source: 'src/components/project/ProjectBodyText.astro',
    props: 'paragraphs[], documentKey?, pathPrefix?, spacing?, sectionId?',
    usedOn: [examples.referenceProject.title],
    preview: 'body-text',
  },
  {
    id: 'component-project-section-title',
    name: 'ProjectSectionTitle',
    category: 'project-content',
    purpose: 'In-page section break heading (Research, Process, etc.).',
    classRef: '.project-section-title',
    source: 'src/components/project/ProjectSectionTitle.astro',
    props: 'title, spacing?, tightBottom? (default true → related after), level? (2 | 3 — 3 renders as Heading 2), showTitle?, hideWhenSidebarVisible?',
    usedOn: [examples.referenceProject.title],
    preview: 'section-title',
  },
  {
    id: 'component-project-press-quote-ticker',
    name: 'ProjectPressQuoteTicker',
    category: 'project-content',
    purpose: 'Horizontally scrolling press quotes with outlet logos.',
    classRef: '.press-quote-ticker',
    source: 'src/components/project/ProjectPressQuoteTicker.astro',
    props: 'items[] (quote, logoSrc, logoAlt, href, name?), documentKey?, sectionPath?, spacing?, speed?, logoOpacity?',
    usedOn: [examples.referenceProject.title],
    preview: 'press-quote-ticker',
  },
  {
    id: 'component-project-reddit-comment-carousel',
    name: 'ProjectRedditCommentCarousel',
    category: 'project-content',
    purpose: 'Masonry board of Reddit-style comment cards with vertical paging.',
    classRef: '.reddit-comment-carousel',
    source: 'src/components/project/ProjectRedditCommentCarousel.astro',
    props: 'items[] (author, paragraphs[], score, avatarSrc?, href?, theme?), documentKey?, sectionPath?, spacing?',
    usedOn: [examples.referenceProject.title],
    preview: 'reddit-comment-carousel',
  },
  {
    id: 'component-project-video',
    name: 'ProjectVideo',
    category: 'project-media',
    purpose: 'Self-hosted video player (media-chrome) with a centred play button, seek bar, and hover/focus volume slider.',
    classRef: '.project-video-player / .project-video-player__play / .project-video-player__progress',
    source: 'src/components/project/ProjectVideo.astro',
    props: 'src, poster?, alt?, autoplay? (default false), aspectRatio? (default "16:9"), spacing?',
    usedOn: [],
    preview: 'video',
  },
  {
    id: 'component-ui-button',
    name: 'Button',
    category: 'ui-primitives',
    purpose: 'Presentational button primitive mirroring the Figma Button (Emphasis × State).',
    classRef: '.dev-btn / .dev-btn--{ghost,soft,filled,page,danger} / .dev-btn--raised (filled, soft)',
    source: 'src/components/ui/Button.astro',
    props: 'emphasis? (ghost | soft | filled | page | danger, default soft), label, type?, disabled?, raised? (filled and soft only: a slight bevel for buttons that should stand out), ...rest',
    usedOn: ['Not yet adopted — Stage 1 primitive'],
    preview: 'ui-button',
  },
  {
    id: 'component-ui-menu',
    name: 'Menu',
    category: 'ui-primitives',
    purpose: 'The one surface for dropdown menus and listboxes. Owns padding (equal to the gap between rows), concentric corners, separator inset, row size and opening and closing instantly; callers only assemble rows and place it. size="page" gives 16px rows for menus opened from page-sized buttons.',
    classRef: '.dev-menu / .dev-menu--page / .dev-menu--bare / .dev-menu__item / .dev-menu > .dev-hairline',
    source: 'src/components/ui/Menu.astro',
    props: 'size? (dev | page, default dev), as? (div | ul, default div), backplate? (default true; false keeps row geometry without the surface), ...rest (role, popover, id); rows are Button with class="dev-menu__item" (ghost, align start, width fill), separators are Hairline',
    usedOn: ['Select listbox', 'Project cover visibility menu', 'Sabi hero Install menu', 'Documentation contents'],
    preview: 'ui-menu',
  },
  {
    id: 'component-ui-segmented-control',
    name: 'SegmentedControl',
    category: 'ui-primitives',
    purpose: 'Presentational shell mirroring the Figma Segmented Control — click a segment in the catalog to move selection; live panels wire their own data-* hooks.',
    classRef: '.dev-segmented',
    source: 'src/components/ui/SegmentedControl.astro',
    props: 'label, ...rest (children passed via default slot)',
    usedOn: ['ViewportSelector', 'Edit carousel Direction', 'Pages', 'Section title visibility'],
    preview: 'ui-segmented-control',
  },
  {
    id: 'component-ui-viewport-selector',
    name: 'ViewportSelector',
    category: 'ui-primitives',
    purpose: 'Figma Dev Panel Viewport Selector — one 3-button Segmented Control with Desktop / Tablet / Mobile baked in.',
    classRef: '.dev-segmented',
    source: 'src/components/ui/ViewportSelector.astro',
    props: 'label? (default "Display width"), dataAttr (required), selected? (desktop | tablet | mobile, default desktop), class, ...rest on the group',
    usedOn: ['Edit image', 'Edit caption', 'Edit grid', 'Edit carousel'],
    preview: 'ui-viewport-selector',
  },
  {
    id: 'component-ui-dev-panel',
    name: 'DevPanel',
    category: 'ui-primitives',
    purpose: 'Live overlay chrome (header, body, traffic lights, resize). Catalog specimens are the same component in embedded mode — dummy title and body only.',
    classRef: '.dev-overlay / .dev-overlay--portrait / .dev-overlay--landscape / .dev-overlay--embedded',
    source: 'src/components/DevOverlay.astro',
    props: 'title? (override only), titleSuffix?, layout? (portrait | landscape, default portrait), embedded?, storageKey?, panelKey?, defaultHidden?, defaultMinimized?, showMinimize?, ...rest (body via default slot; header from panelKey via DevPanelTitle)',
    usedOn: ['Pages', 'Asset manager', 'Log issue', 'Crop / grid / caption tuners', 'Project settings'],
    preview: 'ui-dev-panel',
  },
  {
    id: 'component-ui-dev-panel-title',
    name: 'DevPanelTitle',
    category: 'ui-primitives',
    purpose: 'Figma Dev Panel Title variants — panelKey is the variant; live overlays resolve the header from the shared title map.',
    classRef: '.dev-overlay__title',
    source: 'src/components/ui/DevPanelTitle.astro, src/lib/devPanelTitles.ts',
    props: 'panelKey?, suffix?, title? (override only)',
    usedOn: ['DevOverlay header on every live dev panel'],
    preview: 'ui-dev-panel-title',
  },
  {
    id: 'component-ui-field',
    name: 'Field',
    category: 'ui-primitives',
    purpose: 'Shared label-over-value shell mirroring the Figma Field Base — every field-like control composes on top of it.',
    classRef: '.dev-field / .dev-field__value',
    source: 'src/components/ui/Field.astro',
    props: 'label, ...rest (value content via default slot)',
    usedOn: ['Not yet adopted — Stage 1 primitive'],
    preview: 'ui-field',
  },
  {
    id: 'component-ui-text-field',
    name: 'TextField',
    category: 'ui-primitives',
    purpose: 'Text input composed on Field — mirrors the Figma Text Field.',
    classRef: '.dev-field / .dev-field__input',
    source: 'src/components/ui/TextField.astro',
    props: 'label, value?, placeholder?, disabled?, ...rest',
    usedOn: ['Not yet adopted — Stage 1 primitive'],
    preview: 'ui-text-field',
  },
  {
    id: 'component-ui-text-area',
    name: 'TextArea',
    category: 'ui-primitives',
    purpose: 'Multi-line text input composed on Field — auto-resizes to typed content, with a native vertical drag handle.',
    classRef: '.dev-field / .dev-field__input--area',
    source: 'src/components/ui/TextArea.astro',
    props: 'label, value?, placeholder?, disabled?, rows? (default 3), ...rest',
    usedOn: ['Not yet adopted — Stage 1 primitive'],
    preview: 'ui-text-area',
  },
  {
    id: 'component-ui-select-field',
    name: 'EditorSelectField',
    category: 'ui-primitives',
    purpose: 'Select input composed on Field — Base UI listbox that opens over the trigger.',
    classRef: '.dev-field / .dev-field__input--select / .base-ui-select-item',
    source: 'src/components/ui/EditorSelectField.astro',
    props: 'label, options ({ value, label, icon? }[] or groups), value?, disabled?, hideLabel?, ...rest',
    usedOn: ['Edit mode panels'],
    preview: 'ui-select-field',
  },
  {
    id: 'component-ui-toggle-row',
    name: 'ToggleRow',
    category: 'ui-primitives',
    purpose: 'Labelled checkbox row mirroring the Figma Toggle Row.',
    classRef: '.dev-toggle / .dev-toggle__checkbox',
    source: 'src/components/ui/ToggleRow.astro',
    props: 'label, checked?, ...rest',
    usedOn: ['Not yet adopted — Stage 1 primitive'],
    preview: 'ui-toggle-row',
  },
  {
    id: 'component-ui-panel-actions',
    name: 'PanelActions',
    category: 'ui-primitives',
    purpose: 'Layout wrapper for a trailing row of Button instances, mirroring the Figma Panel Actions composition.',
    classRef: '.dev-panel-actions',
    source: 'src/components/ui/PanelActions.astro',
    props: '...rest (Button instances via default slot)',
    usedOn: ['Not yet adopted — Stage 1 primitive'],
    preview: 'ui-panel-actions',
  },
  {
    id: 'component-ui-badge',
    name: 'Badge',
    category: 'ui-primitives',
    purpose: 'Small status label mirroring the Figma Badge — e.g. gallery/asset thumb overlays.',
    classRef: '.dev-badge',
    source: 'src/components/ui/Badge.astro',
    props: 'label, ...rest',
    usedOn: ['Not yet adopted — Stage 1 primitive'],
    preview: 'ui-badge',
  },
  {
    id: 'component-ui-hairline',
    name: 'Hairline',
    category: 'ui-primitives',
    purpose: '1px rule mirroring the Figma Hairline — dividers inside dev-chrome layouts. orientation=vertical for in-row splits (Add vs gap chips).',
    classRef: '.dev-hairline / .dev-hairline--vertical',
    source: 'src/components/ui/Hairline.astro',
    props: 'orientation, ...rest',
    usedOn: ['Not yet adopted — Stage 1 primitive'],
    preview: 'ui-hairline',
  },
  ];
}


/** Legacy Webflow-migration markup on other case studies — not signed off. Do not copy into new work. */

export const foundationPages = [
  { id: 'styles-typography', slug: 'typography', label: 'Typography' },
  { id: 'styles-spacing', slug: 'spacing', label: 'Spacing' },
  { id: 'styles-layout-rules', slug: 'layout-rules', label: 'Layout rules' },
];

export function stylesPages(examples: Parameters<typeof stylesComponents>[0]) {
  const components = stylesComponents(examples);
  return [
    { id: 'styles-intro', slug: '', label: 'Overview', group: 'Design system' },
    ...foundationPages.map((page) => ({ ...page, group: 'Foundations' })),
    { id: 'styles-components', slug: 'page-blocks', label: 'Page blocks', group: 'Page blocks' },
    ...Object.entries(categoryLabels).filter(([category]) => category !== 'ui-primitives')
      .flatMap(([category, group]) => components.filter((entry) => entry.category === category)
        .map(({ id, name }) => ({ id, slug: id, label: name, group }))),
    { id: 'styles-dev-components', slug: 'dev-components', label: 'Dev components', group: 'Dev components' },
    ...components.filter((entry) => entry.category === 'ui-primitives')
      .map(({ id, name }) => ({ id, slug: id, label: name, group: 'Dev components' })),
  ].map((page) => ({ ...page, href: page.slug ? `/styles/${page.slug}` : '/styles' }));
}
