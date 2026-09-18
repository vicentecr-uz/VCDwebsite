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
    hold: num(root, '--hold', 1400) * speed,
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

const ctrl = <T extends HTMLElement>(panel: HTMLElement, key: string) => (
  panel.querySelector<T>(`[data-ctrl="${key}"]`)
);

const out = (panel: HTMLElement, key: string) => panel.querySelector(`[data-out="${key}"]`);

export const bindSignupMotionPanel = (panel: HTMLElement, root: HTMLElement) => {
  if (panel.dataset.bound === 'true') return;
  panel.dataset.bound = 'true';
  const STORAGE_KEY = 'vcd:signup-success-motion-v3';
  const factoryValues = Object.fromEntries(
    [...panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-ctrl]')].map((el) => [
      el.dataset.ctrl ?? '',
      el.value,
    ]),
  );

  const readControls = () => {
    const speed = Number(ctrl<HTMLSelectElement>(panel, 'speed')?.value ?? 1);
    const ease = ctrl<HTMLSelectElement>(panel, 'ease')?.value ?? '';
    const emailVsCheck = Number(ctrl<HTMLInputElement>(panel, 'emailVsCheck')?.value ?? 100);
    const anticipate = Number(ctrl<HTMLInputElement>(panel, 'anticipate')?.value ?? 10);
    const anticipateMs = Number(ctrl<HTMLInputElement>(panel, 'anticipateMs')?.value ?? 100);
    const anticipateEase = ctrl<HTMLSelectElement>(panel, 'anticipateEase')?.value ?? '';
    const squash = Number(ctrl<HTMLInputElement>(panel, 'squash')?.value ?? 0.1);
    const storeMs = Number(ctrl<HTMLInputElement>(panel, 'storeMs')?.value ?? 70);
    const emailMs = Number(ctrl<HTMLInputElement>(panel, 'emailMs')?.value ?? 500);
    const releaseEase = ctrl<HTMLSelectElement>(panel, 'releaseEase')?.value ?? '';
    const accel = Number(ctrl<HTMLInputElement>(panel, 'accel')?.value ?? 12000);
    const vmax = Number(ctrl<HTMLInputElement>(panel, 'vmax')?.value ?? 1600);
    const stretch = Number(ctrl<HTMLInputElement>(panel, 'stretch')?.value ?? 0.1);
    const returnAt = Number(ctrl<HTMLInputElement>(panel, 'returnAt')?.value ?? 80);
    const returnSpan = Number(ctrl<HTMLInputElement>(panel, 'returnSpan')?.value ?? 40);
    const returnMs = Number(ctrl<HTMLInputElement>(panel, 'returnMs')?.value ?? 300);
    const checkVsLast = Number(ctrl<HTMLInputElement>(panel, 'checkVsLast')?.value ?? 0);
    const inStagger = Number(ctrl<HTMLInputElement>(panel, 'inStagger')?.value ?? 50);
    const inMove = Number(ctrl<HTMLInputElement>(panel, 'inMove')?.value ?? 14);
    const inBlur = Number(ctrl<HTMLInputElement>(panel, 'inBlur')?.value ?? 12);
    const inMs = Number(ctrl<HTMLInputElement>(panel, 'inMs')?.value ?? 320);
    const placeholderWait = Number(ctrl<HTMLInputElement>(panel, 'placeholderWait')?.value ?? 400);
    root.style.setProperty('--speed', String(speed));
    root.style.setProperty('--ease', ease);
    root.style.setProperty('--email-vs-check', String(emailVsCheck));
    root.style.setProperty('--anticipate', String(anticipate));
    root.style.setProperty('--anticipate-ms', String(anticipateMs));
    root.style.setProperty('--anticipate-ease', anticipateEase);
    root.style.setProperty('--squash', String(squash));
    root.style.setProperty('--store-ms', String(storeMs));
    root.style.setProperty('--email-ms', String(emailMs));
    root.style.setProperty('--release-ease', releaseEase);
    root.style.setProperty('--release-accel', String(accel));
    root.style.setProperty('--release-vmax', String(vmax));
    root.style.setProperty('--stretch', String(stretch));
    root.style.setProperty('--return-at', String(returnAt));
    root.style.setProperty('--return-span', String(returnSpan));
    root.style.setProperty('--return-ms', String(returnMs));
    root.style.setProperty('--check-vs-last', String(checkVsLast));
    root.style.setProperty('--gi-in-stagger', String(inStagger));
    root.style.setProperty('--gi-in-move', String(inMove));
    root.style.setProperty('--gi-in-blur', String(inBlur));
    root.style.setProperty('--gi-in-ms', String(inMs));
    root.style.setProperty('--placeholder-wait', String(placeholderWait));
    const setOut = (key: string, value: string) => {
      const node = out(panel, key);
      if (node) node.textContent = value;
    };
    setOut('emailVsCheck', `${emailVsCheck}ms`);
    setOut('anticipate', `${anticipate}px`);
    setOut('anticipateMs', `${anticipateMs}ms`);
    setOut('squash', squash.toFixed(2));
    setOut('storeMs', `${storeMs}ms`);
    setOut('emailMs', `${emailMs}ms`);
    setOut('accel', `${Math.round(accel)} px/s²`);
    setOut('vmax', `${Math.round(vmax)} px/s`);
    setOut('stretch', stretch.toFixed(2));
    setOut('returnAt', `${returnAt}%`);
    setOut('returnSpan', `${returnSpan}%`);
    setOut('returnMs', `${returnMs}ms`);
    setOut('checkVsLast', `${checkVsLast}ms`);
    setOut('inStagger', `${inStagger}ms`);
    setOut('inMove', `${inMove}px`);
    setOut('inBlur', `${inBlur}px`);
    setOut('inMs', `${inMs}ms`);
    setOut('placeholderWait', `${placeholderWait}ms`);
  };

  const applyCtrlMap = (map: Record<string, string>) => {
    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-ctrl]').forEach((el) => {
      const key = el.dataset.ctrl;
      if (key && Object.hasOwn(map, key)) el.value = String(map[key]);
    });
  };

  const snapshotControls = () => Object.fromEntries(
    [...panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-ctrl]')].map((el) => [
      el.dataset.ctrl ?? '',
      el.value,
    ]),
  );

  const flashButton = (btn: HTMLElement, temp: string, original: string) => {
    btn.textContent = temp;
    setTimeout(() => { btn.textContent = original; }, 1200);
  };

  const readSaved = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Record<string, string>;
    } catch {
      return null;
    }
  };

  panel.querySelectorAll('[data-ctrl]').forEach((el) => {
    el.addEventListener('input', readControls);
  });
  panel.querySelector('[data-copy]')?.addEventListener('click', async (event) => {
    const text = [
      `emailVsCheck: ${ctrl(panel, 'emailVsCheck')?.value}ms`,
      `anticipate: ${ctrl(panel, 'anticipate')?.value}px`,
      `anticipateMs: ${ctrl(panel, 'anticipateMs')?.value}ms`,
      `anticipateEase: ${ctrl(panel, 'anticipateEase')?.value}`,
      `squash: ${ctrl(panel, 'squash')?.value}`,
      `storeMs: ${ctrl(panel, 'storeMs')?.value}ms`,
      `emailTravel: ${ctrl(panel, 'emailMs')?.value}ms`,
      `releaseEase: ${ctrl(panel, 'releaseEase')?.value}`,
      `accel: ${ctrl(panel, 'accel')?.value}px/s²`,
      `vmax: ${ctrl(panel, 'vmax')?.value}px/s`,
      `stretch: ${ctrl(panel, 'stretch')?.value}`,
      `returnAt: ${ctrl(panel, 'returnAt')?.value}%`,
      `returnSpan: ${ctrl(panel, 'returnSpan')?.value}%`,
      `returnDuration: ${ctrl(panel, 'returnMs')?.value}ms`,
      `checkVsLast: ${ctrl(panel, 'checkVsLast')?.value}ms`,
      `inStagger: ${ctrl(panel, 'inStagger')?.value}ms`,
      `inMove: ${ctrl(panel, 'inMove')?.value}px`,
      `inBlur: ${ctrl(panel, 'inBlur')?.value}px`,
      `inMs: ${ctrl(panel, 'inMs')?.value}ms`,
      `placeholderWait: ${ctrl(panel, 'placeholderWait')?.value}ms`,
      `ease: ${ctrl(panel, 'ease')?.value}`,
      `speed: ${ctrl(panel, 'speed')?.value}x`,
    ].join(' · ');
    await navigator.clipboard.writeText(text);
    flashButton(event.currentTarget as HTMLElement, 'Copied', 'Copy config');
  });
  panel.querySelector('[data-save]')?.addEventListener('click', (event) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotControls()));
    } catch { /* private mode */ }
    flashButton(event.currentTarget as HTMLElement, 'Saved', 'Save');
  });
  panel.querySelector('[data-revert]')?.addEventListener('click', (event) => {
    applyCtrlMap({ ...factoryValues, ...(readSaved() ?? {}) });
    readControls();
    flashButton(event.currentTarget as HTMLElement, 'Reverted', 'Revert');
  });
  const saved = readSaved();
  if (saved) applyCtrlMap(saved);
  readControls();
};
