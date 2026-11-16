import type { SabiInput } from 'sabi-input';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const fadeMask = (left: number, right: number, linear: boolean, fadeWidth: number, solid: number) => {
  const stops = linear ? [0, 1] : Array.from({ length: 9 }, (_, i) => i / 8);
  const side = (progress: number, reverse: boolean) => stops.map((t) => {
    const alpha = linear ? t : t * t * (3 - 2 * t);
    const x = progress * (solid + (fadeWidth - solid) * t);
    return `rgb(0 0 0 / ${alpha}) ${reverse ? `calc(100% - ${x}px)` : `${x}px`}`;
  });
  return `linear-gradient(to right, ${[...side(left, false), ...side(right, true).reverse()].join(', ')})`;
};

export function mountSabiDemo(root: HTMLElement) {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const kind = root.dataset.kind!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-choice]')];
  const setButtons = (choice: string) => buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.choice === choice)));
  if (kind === 'handles') {
    const example = root.querySelector<HTMLElement>('.handle-example')!;
    buttons.forEach((button) => button.addEventListener('click', () => {
      example.dataset.choice = button.dataset.choice;
      example.setAttribute('aria-label', `Selection handle clipping illustration: ${button.textContent?.trim()}`);
      setButtons(button.dataset.choice!);
    }, { signal }));
    return { destroy: () => lifecycle.abort(), stop: () => {}, choose: () => {}, selectAll: () => {}, text: (_value: string) => {}, seek: (_offset: number) => 0, caretTarget: (x: number) => ({ x, offset: 0 }), begin: (_offset?: number) => {}, finish: () => {} };
  }

  const input = root.querySelector<HTMLInputElement>('input')!;
  let strip = input.parentElement!;
  strip.dataset.target = 'strip';
  const geometry = () => {
    const style = getComputedStyle(strip);
    const value = (name: string, fallback: number) => Number.parseFloat(style.getPropertyValue(name)) || fallback;
    const fadeWidth = value('--sabi-fade-width', 22);
    const gutter = value('--sabi-edge-gutter', 8);
    return {
      fadeWidth, gutter, solid: value('--sabi-fade-solid', 8),
      safeInset: Math.max(gutter, fadeWidth - value('--sabi-caret-penetration', 4)),
    };
  };
  const caret = document.createElement('i');
  caret.className = 'sabi-auto-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;
  strip.append(caret);
  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;white-space:pre;pointer-events:none';
  probe.setAttribute('aria-hidden', 'true');
  document.body.append(probe);
  const width = (text: string) => {
    const style = getComputedStyle(input);
    probe.style.font = style.font;
    probe.style.letterSpacing = style.letterSpacing;
    probe.textContent = text;
    return probe.getBoundingClientRect().width;
  };
  let auto = false;
  let frame = 0;
  let fadeFrame = 0;
  let left = 0;
  let right = 0;
  let mode = 'after';
  let composing = false;

  const cancelFrames = () => { cancelAnimationFrame(frame); cancelAnimationFrame(fadeFrame); fadeFrame = 0; lastPaint = 0; };
  const stop = () => {
    auto = false;
    delete input.dataset.demoSelected;
    caret.hidden = true;
    // Leave the fade paint running: it only settles on the current scroll, and cutting it short freezes an edge.
    cancelAnimationFrame(frame);
  };
  // The fade kind replays the old 150ms lag. It chases its target frame by frame
  // (95% there in 150ms), so a steady stream of scroll events can't hold it in place.
  let target = { left: 0, right: 0 };
  let lastPaint = 0;
  const paintFade = (now: number) => {
    const k = 1 - Math.exp(-(lastPaint ? now - lastPaint : 16) / 50);
    lastPaint = now;
    left += (target.left - left) * k;
    right += (target.right - right) * k;
    const settled = Math.abs(target.left - left) < .002 && Math.abs(target.right - right) < .002;
    if (settled) ({ left, right } = target);
    const { fadeWidth, solid } = geometry();
    strip.style.maskImage = fadeMask(left, right, false, fadeWidth, solid);
    fadeFrame = settled ? 0 : requestAnimationFrame(paintFade);
    if (settled) lastPaint = 0;
  };
  const fades = () => {
    if (mode !== 'before') return;
    const { fadeWidth, solid } = geometry();
    const toLeft = clamp(strip.scrollLeft / fadeWidth);
    const toRight = clamp((strip.scrollWidth - strip.clientWidth - strip.scrollLeft) / fadeWidth);
    if (kind !== 'fade') {
      left = toLeft; right = toRight;
      strip.style.maskImage = fadeMask(left, right, kind === 'gradient', fadeWidth, solid);
      return;
    }
    target = { left: toLeft, right: toRight };
    fadeFrame ||= requestAnimationFrame(paintFade);
  };
  const position = (offset: number, inset: number) => {
    const x = geometry().gutter + width(input.value.slice(0, offset));
    const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
    if (offset === 0) strip.scrollLeft = 0;
    else if (offset === input.value.length) strip.scrollLeft = max;
    else if (x - strip.scrollLeft < inset) strip.scrollLeft = x - inset;
    else if (x - strip.scrollLeft > strip.clientWidth - inset) strip.scrollLeft = x - strip.clientWidth + inset;
    caret.style.left = `${x}px`;
    caret.getAnimations?.().forEach((animation) => { animation.currentTime = 0; });
    fades();
  };
  const renderBefore = () => {
    if (mode !== 'before' || auto || composing) return;
    input.style.width = `${width(input.value) + 2}px`;
    const offset = input.selectionEnd ?? input.value.length;
    position(offset, kind === 'caret' || kind === 'jump' ? 1 : geometry().safeInset);
    if (kind === 'jump') frame = requestAnimationFrame(() => position(offset, geometry().safeInset));
  };
  const onScroll = () => fades();
  strip.addEventListener('scroll', onScroll, { passive: true, signal });
  const choose = (choice: string) => {
    if (mode === choice) return;
    const selection = [input.selectionStart, input.selectionEnd] as const;
    const scroll = strip.scrollLeft;
    const focused = document.activeElement === input;
    cancelFrames();
    const next = document.createElement(choice === 'after' ? 'sabi-input' : 'div');
    if (choice === 'before') next.className = 'sabi-before';
    next.dataset.target = 'strip';
    strip.removeEventListener('scroll', onScroll);
    strip.replaceWith(next);
    next.append(input, caret);
    strip = next;
    strip.addEventListener('scroll', onScroll, { passive: true, signal });
    mode = choice; root.dataset.mode = choice; setButtons(choice);
    input.setSelectionRange(selection[0], selection[1]);
    strip.scrollLeft = scroll;
    if (focused) input.focus({ preventScroll: true });
    if (choice === 'before') { renderBefore(); fades(); }
    else (strip as SabiInput).sync?.();
  };
  buttons.forEach((button) => button.addEventListener('click', () => { stop(); choose(button.dataset.choice!); }, { signal }));
  input.addEventListener('compositionstart', () => { composing = true; }, { signal });
  input.addEventListener('compositionend', () => { composing = false; renderBefore(); }, { signal });
  input.addEventListener('input', renderBefore, { signal });
  input.addEventListener('keydown', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(renderBefore); }, { signal });
  input.addEventListener('click', renderBefore, { signal });
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) renderBefore(); }, { signal });

  return {
    choose,
    caretTarget(at: number) {
      const field = input.closest<HTMLElement>('.sabi-demo-field') ?? strip;
      const box = field.getBoundingClientRect();
      const scale = (field.offsetWidth && box.width / field.offsetWidth) || 1;
      const inputLeft = input.getBoundingClientRect().left;
      const x = (box.left + box.width * at - inputLeft) / scale;
      let offset = 0;
      let distance = Math.abs(x);
      for (let i = 1; i <= input.value.length; i++) {
        const next = Math.abs(width(input.value.slice(0, i)) - x);
        if (next >= distance) break;
        distance = next;
        offset = i;
      }
      return { x: (inputLeft - box.left + width(input.value.slice(0, offset)) * scale) / box.width, offset };
    },
    begin(offset?: number) {
      auto = true;
      caret.hidden = false;
      if (offset !== undefined) input.setSelectionRange(offset, offset);
      position(input.selectionEnd ?? 0, geometry().safeInset);
    },
    selectAll() {
      input.setSelectionRange(0, input.value.length);
      input.dataset.demoSelected = '';
      caret.hidden = true;
    },
    text(value: string) {
      delete input.dataset.demoSelected;
      caret.hidden = !auto;
      input.value = value;
      input.style.width = `${width(value) + 2}px`;
      input.setSelectionRange(value.length, value.length);
      position(value.length, geometry().safeInset);
    },
    seek(offset: number) {
      input.setSelectionRange(offset, offset);
      position(offset, mode === 'before' && (kind === 'caret' || kind === 'jump') ? 1 : geometry().safeInset);
      if (mode === 'before' && kind === 'jump') {
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { if (auto) position(offset, geometry().safeInset); }); });
      }
      return strip.scrollLeft;
    },
    stop,
    finish() { auto = false; },
    destroy() { stop(); lifecycle.abort(); probe.remove(); caret.remove(); },
  };
}
