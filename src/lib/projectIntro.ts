export type IntroSection = Record<string, unknown>;

export const normalizeIntroHeight = (value: unknown, fallback = 75): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : fallback;
};

export function introRun(sections: IntroSection[]): IntroSection[][] {
  const runs: IntroSection[][] = [];
  let current: IntroSection[] = [];
  for (const section of sections) {
    const isIntro = (section.type === 'bodyText' || section.type === 'sectionTitle')
      && section.intro === true;
    if (isIntro) current.push(section);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

export function resolveIntroHeight(
  documentHeight: unknown,
  members: IntroSection[],
): number {
  const legacy = members.find((member) => Number.isFinite(Number(member.introHeight)))?.introHeight;
  return normalizeIntroHeight(documentHeight, normalizeIntroHeight(legacy));
}

/** Height available for flexible air after authored content and stack spacing. */
export function introLayout(
  targetVh: number,
  safeVhPx: number,
  naturalHeightPx: number,
) {
  const targetPx = Math.max(0, safeVhPx * normalizeIntroHeight(targetVh) / 100);
  const flexibleAirPx = Math.max(0, targetPx - naturalHeightPx);
  return {
    targetPx,
    flexibleAirPx,
    outerGapPx: flexibleAirPx / 2,
  };
}
