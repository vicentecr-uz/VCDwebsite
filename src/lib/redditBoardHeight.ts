export const boardViewports = ['desktop', 'tablet', 'mobile'] as const;
export type BoardViewport = (typeof boardViewports)[number];
export type BoardHeights = Partial<Record<BoardViewport, number | null>>;

export function resolveRedditBoardHeights(authored: BoardHeights) {
  const desktop = authored.desktop ?? 20;
  const tablet = authored.tablet === null ? desktop : authored.tablet ?? 32;
  const mobile = authored.mobile === null ? tablet : authored.mobile ?? 26;
  return { desktop, tablet, mobile };
}
