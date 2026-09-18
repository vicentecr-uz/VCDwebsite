export type SignupMotionCfg = {
  stagger: number;
  charMs: number;
  move: number;
  taper: number;
  scale: number;
  blur: number;
  overlap: number;
  checkMs: number;
  hold: number;
  emailVsCheck: number;
  anticipate: number;
  anticipateMs: number;
  storeMs: number;
  emailMs: number;
  returnAt: number;
  returnSpan: number;
  returnMs: number;
  checkVsLast: number;
  inStagger: number;
  inMove: number;
  inBlur: number;
  inMs: number;
  placeholderWait: number;
  squash: number;
  stretch: number;
  accel: number;
  vmax: number;
  speed: number;
  ease: string;
  anticipateEase: string;
  releaseEase: string;
};

const num = (root: HTMLElement, name: string, fallback: number) => {
  const parsed = Number.parseFloat(getComputedStyle(root).getPropertyValue(name).trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cssString = (root: HTMLElement, name: string, fallback: string) => {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  return raw || fallback;
};

export const readSignupMotionCfg = (root: HTMLElement): SignupMotionCfg => {
  const speed = num(root, '--speed', 1);
  return {
    stagger: num(root, '--stagger', 10) * speed,
    charMs: num(root, '--char-ms', 500) * speed,
    move: num(root, '--move', 8),
    taper: num(root, '--taper', 20) / 100,
    scale: num(root, '--scale-to', 0.97),
    blur: num(root, '--blur', 10),
    overlap: num(root, '--overlap', 400) * speed,
    checkMs: num(root, '--check-ms', 160) * speed,
    hold: num(root, '--hold', 1000) * speed,
    emailVsCheck: num(root, '--email-vs-check', 100) * speed,
    anticipate: num(root, '--anticipate', 10),
    anticipateMs: num(root, '--anticipate-ms', 100) * speed,
    storeMs: num(root, '--store-ms', 70) * speed,
    emailMs: num(root, '--email-ms', 500) * speed,
    returnAt: num(root, '--return-at', 80) / 100,
    returnSpan: num(root, '--return-span', 40) / 100,
    returnMs: num(root, '--return-ms', 300) * speed,
    checkVsLast: num(root, '--check-vs-last', 0) * speed,
    inStagger: num(root, '--gi-in-stagger', 50) * speed,
    inMove: num(root, '--gi-in-move', 14),
    inBlur: num(root, '--gi-in-blur', 12),
    inMs: num(root, '--gi-in-ms', 320) * speed,
    placeholderWait: num(root, '--placeholder-wait', 400) * speed,
    squash: num(root, '--squash', 0.1),
    stretch: num(root, '--stretch', 0.1),
    accel: num(root, '--release-accel', 12000),
    vmax: num(root, '--release-vmax', 1600),
    speed,
    ease: cssString(root, '--ease', 'cubic-bezier(0.23, 1, 0.32, 1)'),
    anticipateEase: cssString(root, '--anticipate-ease', 'cubic-bezier(0.4, 0.05, 0.6, 0.95)'),
    releaseEase: cssString(root, '--release-ease', 'cubic-bezier(0.5, 0, 0.75, 0.16)'),
  };
};

export const throwDurationMs = (distance: number, accel: number, vmax: number, fallbackMs: number) => {
  if (distance <= 0) return 0;
  if (accel <= 0 || vmax <= 0) return fallbackMs;
  const tAccel = vmax / accel;
  const dAccel = 0.5 * accel * tAccel * tAccel;
  if (dAccel >= distance) return Math.sqrt((2 * distance) / accel) * 1000;
  return (tAccel + (distance - dAccel) / vmax) * 1000;
};

export const throwOffsetAt = (tMs: number, distance: number, accel: number, vmax: number) => {
  if (distance <= 0 || tMs <= 0) return 0;
  const t = tMs / 1000;
  const tAccel = vmax / accel;
  const dAccel = 0.5 * accel * tAccel * tAccel;
  if (dAccel >= distance) return Math.min(distance, 0.5 * accel * t * t);
  if (t <= tAccel) return 0.5 * accel * t * t;
  return Math.min(distance, dAccel + vmax * (t - tAccel));
};

const pose = (x: number, sx: number, sy: number) => `translateX(${x}px) scaleX(${sx}) scaleY(${sy})`;

export const animateRelease = (
  el: HTMLElement,
  fromX: number,
  toX: number,
  fromSx: number,
  fromSy: number,
  toSx: number,
  toSy: number,
  cfg: SignupMotionCfg,
) => {
  const distance = toX - fromX;
  const usePhysics = cfg.accel > 0 && cfg.vmax > 0 && distance > 0;
  if (!usePhysics) {
    const animation = el.animate(
      [{ transform: pose(fromX, fromSx, fromSy) }, { transform: pose(toX, toSx, toSy) }],
      { duration: cfg.emailMs, easing: cfg.releaseEase, fill: 'forwards' },
    );
    return {
      duration: cfg.emailMs,
      finished: animation.finished.catch(() => undefined).then(() => undefined),
    };
  }
  const unscaled = throwDurationMs(distance, cfg.accel, cfg.vmax, cfg.emailMs / cfg.speed);
  const duration = unscaled * cfg.speed;
  const finished = new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(unscaled, (now - t0) / cfg.speed);
      const d = throwOffsetAt(t, distance, cfg.accel, cfg.vmax);
      const p = d / distance;
      el.style.transform = pose(fromX + d, fromSx + (toSx - fromSx) * p, fromSy + (toSy - fromSy) * p);
      if (t < unscaled) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  return { duration, finished };
};
