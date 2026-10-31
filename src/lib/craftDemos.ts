export const CRAFT_DEMOS = [
  { id: 'sabi-playground', title: 'Sabi', height: 23 },
  { id: 'sabi-caret', title: 'Keeping the caret visible', height: 23 },
  { id: 'sabi-jump', title: 'A one-frame jump', height: 23 },
  { id: 'sabi-fade', title: 'Fades that follow scrolling', height: 23 },
  { id: 'sabi-gradient', title: 'Easing the gradient', height: 23 },
  { id: 'sabi-direction', title: 'Mixed-direction text', height: 23 },
  { id: 'sabi-handles', title: 'Selection handle clipping illustration', height: 23 },
  { id: 'select-field', title: 'Select field', height: 28 },
  { id: 'progressive-image', title: 'Progressive image loading', height: 31 },
  { id: 'adaptive-ink', title: 'Adaptive ink', height: 42 },
  { id: 'image-framing', title: 'Image framing', height: 48, narrowHeight: 68, frame: 'none' },
  { id: 'gap-spacing', title: 'Draggable block system', height: 42 },
  { id: 'block-reorder', title: 'Block reorder', height: 46 },
  { id: 'proximity', title: 'Proximity reveal', height: 36 },
] as const;

export function craftDemo(id: unknown) {
  return CRAFT_DEMOS.find((demo) => demo.id === id);
}
