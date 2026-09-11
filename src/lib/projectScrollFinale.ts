export type ScrollFinaleSection = Record<string, unknown>;

export function shouldUseProjectScrollFinale(
  scrollFinale: unknown,
  sections: unknown,
): boolean {
  if (scrollFinale !== true || !Array.isArray(sections) || sections.length < 2) return false;

  const fadeSection = sections.at(-2);
  const targetSection = sections.at(-1);
  return isImageSection(fadeSection) && isImageSection(targetSection);
}

function isImageSection(section: unknown): section is ScrollFinaleSection {
  return typeof section === 'object' && section !== null && !Array.isArray(section)
    && (section as ScrollFinaleSection).type === 'image';
}
