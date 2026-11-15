const omega = 2 * Math.PI / (0.35 * 1.2);

export function viewportMorphProgress(elapsedMs: number) {
  const t = elapsedMs / 1000;
  const remaining = Math.exp(-omega * t) * (1 + omega * t);
  return remaining <= 0.004 ? 1 : 1 - remaining;
}
