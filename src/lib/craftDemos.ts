// Exhibits for the /reports design explorations. They are served outside /preview, so the
// craft-demo contract (scripts/test/craft-demo-build.test.mjs) stays about signed-off demos.
const prototype = (id: string, title: string, height: number, narrowHeight = height) =>
  ({ id: `future-${id}`, title, height, narrowHeight, route: `/reports/prototypes/${id}` });

export const CRAFT_DEMOS = [
  { id: 'url-field', title: 'Try Sabi', height: 10 },
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
  // Inline and content-sized: height is unused, data comes from the block's `sample`.
  { id: 'bar-chart', title: 'Bar chart', height: 0 },
  prototype('inline-bar', 'On-canvas image bar', 36, 34),
  prototype('inherited-values', 'Inherited values', 24),
  prototype('change-ledger', 'Change ledger', 24),
  prototype('phone-sheet', 'Panel as a sheet', 41),
  prototype('compare', 'Before and after', 30, 22),
  prototype('hotspots', 'Annotated image', 40, 37),
  prototype('deep-dive', 'Deep dive', 36),
  prototype('sidenotes', 'Sidenotes', 28, 30),
  prototype('window-frame', 'Window frame', 28, 27),
  prototype('slider', 'Slider', 26),
  prototype('command-menu', 'Command menu', 30),
  prototype('toast', 'Toast', 22),
  prototype('hold-confirm', 'Hold to confirm', 22),
  prototype('index-list', 'Index as a list', 30),
  prototype('skim-read', 'Skim and read', 38),
  prototype('rail-schematic', 'Page rails', 32, 32),
] as const;

export function craftDemo(id: unknown) {
  return CRAFT_DEMOS.find((demo) => demo.id === id);
}
