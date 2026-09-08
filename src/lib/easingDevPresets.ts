export interface CubicEasingPreset {
  name: string;
  type: 'cubic';
  points: readonly [number, number, number, number];
}

export interface SpringEasingPreset {
  name: string;
  type: 'spring';
  stiffness: number;
  damping: number;
  mass: number;
}

export type EasingDevPreset = CubicEasingPreset | SpringEasingPreset;

export const CUBIC_EASING_PRESETS: readonly CubicEasingPreset[] = [
  ['Anticipate', 1, -.4, .35, .95], ['Quick Out', 0, 0, .2, 1], ['Overshoot Out', .175, .885, .32, 1.275],
  ['Swift Out', .175, .885, .32, 1.1], ['Snappy Out', .19, 1, .22, 1], ['In Out', .42, 0, .58, 1],
  ['In Quad', .55, .085, .68, .53], ['In Cubic', .55, .055, .675, .19], ['In Quart', .895, .03, .685, .22],
  ['In Quint', .755, .05, .855, .06], ['In Expo', .95, .05, .795, .035], ['In Circ', .6, .04, .98, .335],
  ['Out Quad', .25, .46, .45, .94], ['Out Cubic', .215, .61, .355, 1], ['Out Quart', .165, .84, .44, 1],
  ['Out Quint', .23, 1, .32, 1], ['Out Expo', .19, 1, .22, 1], ['Out Circ', .075, .82, .165, 1],
  ['In Out Quad', .455, .03, .515, .955], ['In Out Cubic', .645, .045, .355, 1], ['In Out Quart', .77, 0, .175, 1],
  ['In Out Quint', .86, 0, .07, 1], ['In Out Expo', 1, 0, 0, 1], ['In Out Circ', .785, .135, .15, .86],
  ['In Out Base', .25, .1, .25, 1], ['In', .42, 0, 1, 1], ['Out', 0, 0, .58, 1], ['Linear', 0, 0, 1, 1],
].map(([name, ...points]) => ({ name, type: 'cubic', points }) as CubicEasingPreset);

export const SPRING_EASING_PRESETS: readonly SpringEasingPreset[] = [
  ['Bouyant', 900, 80, 10], ['Elegant', 150, 19, 1.2], ['Bob', 131.1, 2.3, .1], ['Fling', 800, 80, 4],
  ['Swift', 280, 18, .3], ['Float', 290, 15, 2], ['Slow', 26.7, 4.1, .2], ['Snap', 320, 20, .4],
  ['Stern', 550, 30, 1.2], ['Boingoingoing', 1000, 1.5, .1],
].map(([name, stiffness, damping, mass]) => ({ name, type: 'spring', stiffness, damping, mass }));

export function springDurationMs({ stiffness, damping, mass }: SpringEasingPreset, threshold = .01) {
  return Number((-(Math.log(threshold) / (damping / (2 * Math.sqrt(mass * stiffness)) * Math.sqrt(stiffness / mass)) * 1000)).toFixed(2));
}

export function generateSpringEasing(preset: SpringEasingPreset, steps = 100, threshold = 1e-4) {
  const { stiffness, damping, mass } = preset;
  const angular = Math.sqrt(stiffness / mass);
  const ratio = damping / (2 * Math.sqrt(mass * stiffness));
  const underDamped = Math.sqrt(1 - ratio ** 2);
  const samples: string[] = [];
  for (let e = 0; e <= steps; e += 1) {
    const time = e / steps;
    const decay = Math.exp(-ratio * angular * time);
    const angle = angular * underDamped * time;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const value = Number.isNaN(cos) || Number.isNaN(sin)
      ? time
      : 1 - decay * (cos + ratio / underDamped * sin);
    const rounded = Number(value.toFixed(6));
    const percentage = Number((e / steps * 100).toFixed(6));
    samples.push(`${rounded} ${percentage}%`);
    if (e > 0 && Math.abs(1 - value) <= threshold) break;
  }
  return `linear(${samples.join(', ')})`;
}

export function presetEasing(preset: EasingDevPreset) {
  if (preset.type === 'cubic') return `cubic-bezier(${preset.points.join(', ')})`;
  return generateSpringEasing(preset);
}
