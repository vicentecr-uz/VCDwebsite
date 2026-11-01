import { define, type SabiInput } from './core';

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
  define();
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

  const cancelFrames = () => { cancelAnimationFrame(frame); cancelAnimationFrame(fadeFrame); };
  const stop = () => {
    auto = false;
    delete input.dataset.demoSelected;
    caret.hidden = true;
    cancelFrames();
  };
  const fades = () => {
    if (mode !== 'before') return;
    const { fadeWidth, solid } = geometry();
    const targetLeft = clamp(strip.scrollLeft / fadeWidth);
    const targetRight = clamp((strip.scrollWidth - strip.clientWidth - strip.scrollLeft) / fadeWidth);
    cancelAnimationFrame(fadeFrame);
    const fromLeft = left, fromRight = right, start = performance.now();
    const paint = (now: number) => {
      const t = kind === 'fade' ? clamp((now - start) / 150) : 1;
      left = fromLeft + (targetLeft - fromLeft) * t;
      right = fromRight + (targetRight - fromRight) * t;
      strip.style.maskImage = fadeMask(left, right, kind === 'gradient', fadeWidth, solid);
      if (t < 1) fadeFrame = requestAnimationFrame(paint);
    };
    paint(start);
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
    else (strip as SabiInput).sync();
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
