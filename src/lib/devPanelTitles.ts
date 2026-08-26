export const DEV_PANEL_TITLES = {
  image: 'Image',
  caption: 'Caption',
  grid: 'Grid',
  carousel: 'Carousel',
  'project-settings': 'Project settings',
  'gallery-pages': 'Gallery manager',
  'asset-manager': 'Asset manager',
  'log-issue': 'Log new issue',
  'section-nav': 'Outline marker',
  'style-color-token': 'Edit colour token',
} as const;

export type DevPanelKey = keyof typeof DEV_PANEL_TITLES;

export function resolveDevPanelTitle(
  panelKey: string | undefined,
  options?: { suffix?: string; override?: string },
): string {
  if (options?.override) return options.override;
  const base =
    panelKey && panelKey in DEV_PANEL_TITLES
      ? DEV_PANEL_TITLES[panelKey as DevPanelKey]
      : (panelKey || 'Panel');
  return options?.suffix ? `${base} — ${options.suffix}` : base;
}
