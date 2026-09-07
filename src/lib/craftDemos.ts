export const CRAFT_DEMOS = [
  { id: 'select-field', title: 'Select field', height: 28 },
  { id: 'progressive-image', title: 'Progressive image loading', height: 42 },
  { id: 'adaptive-ink', title: 'Adaptive ink', height: 42 },
  { id: 'image-framing', title: 'Image framing', height: 48 },
  { id: 'block-reorder', title: 'Block reorder', height: 44 },
  { id: 'proximity', title: 'Proximity reveal', height: 36 },
] as const;

export function craftDemo(id: unknown) {
  return CRAFT_DEMOS.find((demo) => demo.id === id);
}
