const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const sectionScrollCurve = [0.14, 0, 0.23, 0, 0.2, 1, 0.41, 1];

const binomial = (n: number, k: number) => {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  const kk = Math.min(k, n - k);
  for (let i = 1; i <= kk; i += 1) {
    result = (result * (n - kk + i)) / i;
  }
  return result;
};

export const flatToControlPairs = (flatPoints: number[]) => {
  const controls = [];
  for (let i = 0; i < flatPoints.length; i += 2) {
    controls.push([clamp01(Number(flatPoints[i])), clamp01(Number(flatPoints[i + 1]))]);
  }
  return controls;
};

export const evaluateBezierPoint = (allPoints: number[][], t: number) => {
  const n = allPoints.length - 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i <= n; i += 1) {
    const basis = binomial(n, i) * (1 - t) ** (n - i) * t ** i;
    x += basis * allPoints[i][0];
    y += basis * allPoints[i][1];
  }
  return [x, y];
};

export const createBezierEaser = (flatControlPoints: number[]) => {
  const controls = flatToControlPairs(flatControlPoints);
  const points = [[0, 0], ...controls, [1, 1]];

  const solveCurveT = (xTarget: number) => {
    let lower = 0;
    let upper = 1;
    let t = xTarget;
    for (let i = 0; i < 16; i += 1) {
      const [x] = evaluateBezierPoint(points, t);
      const error = x - xTarget;
      if (Math.abs(error) < 0.0005) return t;
      if (error > 0) upper = t;
      else lower = t;
      t = (lower + upper) / 2;
    }
    return t;
  };

  return (x: number) => {
    const xTarget = clamp01(x);
    const t = solveCurveT(xTarget);
    const [, y] = evaluateBezierPoint(points, t);
    return clamp01(y);
  };
};

export function sectionScrollTop({ top, height }: { top: number; height: number },
  start: number, viewport: number, pageHeight: number, offset = 152) {
  // Centre a hero-sized block. Short blocks and long wrappers start under the header.
  const inset = height >= viewport * 0.65 && height <= viewport * 2 ? (viewport - height) / 2 : offset;
  return Math.min(Math.max(start + top - inset, 0),
    Math.max(pageHeight - viewport, 0));
}

export const sectionScrollDuration = (distance: number) => Math.min(900, Math.max(480, Math.abs(distance) * 0.55));

export function scrollToEditorBlock(block: HTMLElement, signal: AbortSignal) {
  const reveal = new CustomEvent('vcd:section-history-reveal', { cancelable: true, detail: { block } });
  if (!window.dispatchEvent(reveal)) return;

  const start = window.scrollY;
  const top = sectionScrollTop(block.getBoundingClientRect(), start, window.innerHeight, document.documentElement.scrollHeight);
  const distance = top - start;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(distance) < 2) {
    window.scrollTo(0, top);
    return;
  }

  const easing = createBezierEaser(sectionScrollCurve);
  const duration = sectionScrollDuration(distance);
  const controller = new AbortController();
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    controller.abort();
    signal.removeEventListener('abort', stop);
  };
  signal.addEventListener('abort', stop, { once: true });
  for (const event of ['wheel', 'touchstart', 'pointerdown']) {
    window.addEventListener(event, stop, { passive: true, signal: controller.signal });
  }
  const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
  window.addEventListener('keydown', (event) => {
    if (scrollKeys.has(event.key)) stop();
  }, { signal: controller.signal });
  const startTime = performance.now();
  const animate = (time: number) => {
    const progress = Math.min((time - startTime) / duration, 1);
    window.scrollTo(0, start + distance * easing(progress));
    if (progress < 1) frame = requestAnimationFrame(animate);
    else stop();
  };
  frame = requestAnimationFrame(animate);
}
