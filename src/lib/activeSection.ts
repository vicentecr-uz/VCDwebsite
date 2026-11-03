type Section = { id: string; top: number };
type Options = {
  scrollY: number;
  viewportHeight: number;
  documentHeight: number;
  earlyRampVh?: number;
  holdVh?: number;
  endRampVh?: number;
};

export function activeSectionId(sections: readonly Section[], {
  scrollY, viewportHeight, documentHeight, earlyRampVh = 0.3, holdVh = 0.25, endRampVh = 0.25,
}: Options): string | undefined {
  const maxScroll = Math.max(documentHeight - viewportHeight, 1);
  const currentScroll = Math.min(Math.max(scrollY, 0), maxScroll);

  const earlyRampDistance = viewportHeight * earlyRampVh;
  const holdOffset = viewportHeight * holdVh;
  const endRampDistance = viewportHeight * endRampVh;
  const endRampStart = Math.max(maxScroll - endRampDistance, earlyRampDistance);
  const endOffset = Math.max(viewportHeight - 12, holdOffset);

  let activationOffset = holdOffset;
  if (currentScroll <= earlyRampDistance) {
    const t = earlyRampDistance === 0 ? 1 : currentScroll / earlyRampDistance;
    activationOffset = holdOffset * t;
  } else if (currentScroll >= endRampStart) {
    const distance = Math.max(maxScroll - endRampStart, 1);
    const t = (currentScroll - endRampStart) / distance;
    activationOffset = holdOffset + (endOffset - holdOffset) * t;
  }

  const pivot = scrollY + activationOffset;
  let activeId = sections[0]?.id;

  for (const section of sections) {
    if (section.top <= pivot) {
      activeId = section.id;
    } else {
      break;
    }
  }

  if (scrollY + viewportHeight >= documentHeight - 2) {
    return sections[sections.length - 1]?.id;
  }

  return activeId;
}
