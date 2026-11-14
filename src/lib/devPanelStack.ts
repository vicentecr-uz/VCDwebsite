export const devPanels = () => [
  ...document.querySelectorAll<HTMLElement>('[data-dev-panel-key]:not([data-embedded])'),
];

export function frontmostOpenPanel() {
  let frontmost: HTMLElement | null = null;
  let highest = -Infinity;
  for (const panel of devPanels()) {
    if (panel.hidden) continue;
    const z = Number.parseInt(getComputedStyle(panel).zIndex, 10) || 0;
    if (z < highest) continue;
    frontmost = panel;
    highest = z;
  }
  return frontmost;
}
