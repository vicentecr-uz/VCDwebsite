type FontCapture = {
  node: Text;
  parent: HTMLElement;
  value: string;
  family: string;
  style: string;
  weight: string;
  size: string;
};

type GlyphRecord = {
  span: HTMLSpanElement;
  family: string;
};

type WrappedText = {
  original: Text;
  spans: HTMLSpanElement[];
};

type FontRevealPrototype = { abort: () => void };

const rootFlag = 'fontRevealPrototype';
const fallbackFamily = 'system-ui, sans-serif';
const durationMs = 4000;
const initialRevealTimeoutMs = 5000;
const fontLoadTimeoutMs = 4000;
// Ceiling: keep the exploratory animation to 1200 glyphs; raise only with measured performance data.
const maxGlyphs = 1200;
const prototypeKey = '__vcdFontRevealPrototype' as const;

const excludedSelector = [
  'script', 'style', 'noscript', 'svg', 'form', 'input', 'textarea', 'select', 'option',
  '[contenteditable]', '[data-dev-mode-only]', '.dev-overlay', '.dev-panel', '[data-dev-overlay]',
].join(',');

export function splitGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), ({ segment }) => segment);
  }
  return Array.from(value);
}

export function shuffleGlyphs<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.max(0, Math.min(0.999999, random())) * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

export function scheduleGlyphReveal(count: number, duration = durationMs): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => duration * (1 - Math.pow(1 - index / count, 1.5)));
}

function visible(element: HTMLElement): boolean {
  const styles = getComputedStyle(element);
  if (styles.display === 'none' || styles.visibility === 'hidden' || styles.opacity === '0') return false;
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

function excluded(node: Text): boolean {
  return node.parentElement?.closest(excludedSelector) !== null;
}

function collectCaptures(scope: HTMLElement): FontCapture[] {
  const captures: FontCapture[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    const node = current as Text;
    const parent = node.parentElement;
    if (parent && node.data.trim() && !excluded(node) && visible(parent)) {
      const styles = getComputedStyle(parent);
      captures.push({
        node,
        parent,
        value: node.data,
        family: styles.fontFamily,
        style: styles.fontStyle,
        weight: styles.fontWeight,
        size: styles.fontSize,
      });
    }
    current = walker.nextNode();
  }
  return captures;
}

function activeScope(): HTMLElement | null {
  const intro = document.querySelector<HTMLElement>('#home-intro-surface');
  if (intro && !intro.hidden && intro.dataset.state !== 'dismissed' && visible(intro)) return intro;
  return document.querySelector<HTMLElement>('#site-wrapper');
}

function neededFontLoads(captures: FontCapture[]): Array<[string, FontCapture]> {
  const loads = new Map<string, [string, FontCapture]>();
  for (const capture of captures) {
    const family = /EB Garamond/i.test(capture.family) ? 'EB Garamond' : /Hanken Grotesk/i.test(capture.family) ? 'Hanken Grotesk' : null;
    if (!family) continue;
    const key = `${family}|${capture.style}|${capture.weight}|${capture.size}`;
    if (!loads.has(key)) loads.set(key, [family, capture]);
  }
  return [...loads.values()];
}

async function loadNeededFonts(captures: FontCapture[], signal: AbortSignal): Promise<void> {
  const fontSet = document.fonts;
  if (!fontSet?.load) throw new Error('Font Loading API unavailable');
  if (signal.aborted) throw new Error('Font load aborted');
  const loads = neededFontLoads(captures).map(async ([family, capture]) => {
    const loaded = await fontSet.load(`${capture.style} ${capture.weight} ${capture.size} "${family}"`);
    if (!loaded.length) throw new Error(`Font did not load: ${family}`);
  });
  if (!loads.length) return;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abort = () => {};
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    abort = () => fail(new Error('Font load aborted'));
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => fail(new Error('Font load timed out')), fontLoadTimeoutMs);
    Promise.all(loads).then(() => { cleanup(); resolve(); }, fail);
  });
}

function waitForInitialReveal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Initial reveal wait aborted'));
  const overlay = document.querySelector<HTMLElement>('#transition-overlay');
  if (!overlay || document.documentElement.dataset.devTransition === 'visible' || overlay.dataset.vcdInitialReveal === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let abort = () => {};
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      window.removeEventListener('vcd:initial-reveal-complete', finish);
      signal.removeEventListener('abort', abort);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Initial reveal wait aborted'));
    };
    timer = setTimeout(finish, initialRevealTimeoutMs);
    window.addEventListener('vcd:initial-reveal-complete', finish, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    if (overlay?.dataset.vcdInitialReveal === 'complete') finish();
  });
}

function setFamily(span: HTMLSpanElement, family: string): void {
  span.style.setProperty('font-family', family, 'important');
}

function unwrap(wrapped: WrappedText[]): void {
  for (const { original, spans } of wrapped) {
    const first = spans[0];
    const parent = first?.parentNode;
    if (!parent) continue;
    parent.insertBefore(original, first);
    for (const span of spans) span.remove();
  }
}

export function startFontRevealPrototype(): FontRevealPrototype | null {
  const root = document.documentElement;
  if (new URLSearchParams(location.search).get('font-reveal') !== 'trickle' || root.classList.contains('is-dev-mode') || root.dataset[rootFlag] !== 'pending') return null;

  const controller = new AbortController();
  const captures: FontCapture[] = [];
  let glyphs: GlyphRecord[] = [];
  let wrapped: WrappedText[] = [];
  let frame = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    controller.abort();
    if (frame) cancelAnimationFrame(frame);
    unwrap(wrapped);
    delete root.dataset[rootFlag];
    window.removeEventListener('pagehide', onAbort);
    window.removeEventListener('vcd:dev-mode-change', onDevModeChange);
  };
  const onAbort = () => finish();
  const onDevModeChange = (event: Event) => {
    if (root.classList.contains('is-dev-mode') || (event as CustomEvent<{ active?: boolean }>).detail?.active) onAbort();
  };
  window.addEventListener('pagehide', onAbort, { once: true });
  window.addEventListener('vcd:dev-mode-change', onDevModeChange);

  // Capture intended fonts while the prepaint fallback is briefly lifted, then restore it synchronously.
  try {
    root.removeAttribute('data-font-reveal-prototype');
    const scope = activeScope();
    if (scope) captures.push(...collectCaptures(scope));
    root.dataset[rootFlag] = 'pending';
  } catch {
    root.dataset[rootFlag] = 'pending';
    finish();
    return { abort: onAbort };
  }

  void (async () => {
    try {
      await loadNeededFonts(captures, controller.signal);
      await waitForInitialReveal(controller.signal);
      if (controller.signal.aborted || root.classList.contains('is-dev-mode')) return;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const currentCaptures = captures.filter((capture) => capture.node.isConnected && capture.node.parentNode === capture.parent && capture.node.data === capture.value && visible(capture.parent));
      if (!currentCaptures.length || reducedMotion) { finish(); return; }
      const shuffled: GlyphRecord[] = [];
      let plannedGlyphs = 0;
      for (const capture of currentCaptures) {
        const segments = splitGraphemes(capture.value);
        if (!segments.length || !capture.node.parentNode || plannedGlyphs + segments.length > maxGlyphs) continue;
        const fragment = document.createDocumentFragment();
        const spans: HTMLSpanElement[] = [];
        for (const segment of segments) {
          const span = document.createElement('span');
          span.textContent = segment;
          span.style.setProperty('font-style', capture.style, 'important');
          span.style.setProperty('font-weight', capture.weight, 'important');
          setFamily(span, fallbackFamily);
          fragment.append(span);
          spans.push(span);
          shuffled.push({ span, family: capture.family });
        }
        capture.node.parentNode.replaceChild(fragment, capture.node);
        wrapped.push({ original: capture.node, spans });
        plannedGlyphs += segments.length;
      }
      glyphs = shuffleGlyphs(shuffled);
      if (!glyphs.length) { finish(); return; }
      root.dataset[rootFlag] = 'running';
      const schedule = scheduleGlyphReveal(glyphs.length);
      const started = performance.now();
      let revealed = 0;
      const tick = (now: number) => {
        if (controller.signal.aborted) return;
        const elapsed = now - started;
        while (revealed < glyphs.length && schedule[revealed] <= elapsed) {
          setFamily(glyphs[revealed].span, glyphs[revealed].family);
          revealed += 1;
        }
        if (revealed >= glyphs.length || elapsed >= durationMs) finish();
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } catch {
      finish();
    }
  })();
  return { abort: onAbort };
}

if (typeof window !== 'undefined') {
  const globalWindow = window as Window & { [prototypeKey]?: FontRevealPrototype };
  const boot = () => {
    if (globalWindow[prototypeKey]) return;
    const prototype = startFontRevealPrototype();
    if (prototype) globalWindow[prototypeKey] = prototype;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  const cleanup = () => {
    globalWindow[prototypeKey]?.abort();
    delete globalWindow[prototypeKey];
  };
  document.addEventListener('astro:before-swap', cleanup);
  document.addEventListener('astro:page-load', boot);
  import.meta.hot?.dispose(() => {
    cleanup();
    document.removeEventListener('DOMContentLoaded', boot);
    document.removeEventListener('astro:before-swap', cleanup);
    document.removeEventListener('astro:page-load', boot);
  });
}
