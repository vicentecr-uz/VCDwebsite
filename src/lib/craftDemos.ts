export const CRAFT_DEMOS = [
  { id: 'select-field', title: 'Select field', height: 28 },
  { id: 'progressive-image', title: 'Progressive image loading', height: 31 },
  { id: 'adaptive-ink', title: 'Adaptive ink', height: 42 },
  { id: 'image-framing', title: 'Image framing', height: 48, narrowHeight: 68 },
  { id: 'gap-spacing', title: 'Draggable block system', height: 42 },
  { id: 'block-reorder', title: 'Block reorder', height: 46 },
  { id: 'proximity', title: 'Proximity reveal', height: 36 },
] as const;

export function craftDemo(id: unknown) {
  return CRAFT_DEMOS.find((demo) => demo.id === id);
}
