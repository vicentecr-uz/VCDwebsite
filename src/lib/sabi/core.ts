// Sabi snapshot 40cbd01 (MIT, Vicente Cruz). Replace with sabi-input once published.
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const TEXT_PROPERTIES = ['font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontFeatureSettings', 'fontVariationSettings', 'textTransform', 'direction', 'unicodeBidi'] as const;

// A hidden copy of the input's text, laid out the way the input lays it out,
// including right-to-left and mixed-direction text (the mirror technique of
// textarea-caret-position, with the caret read from a Range instead of a marker).
// Fixed, so a long value can't widen the page, and emptied after each use, so the
// text doesn't linger in the document.
let mirror: HTMLSpanElement | null = null;

const layout = (input: HTMLInputElement, text: string) => {
  if (!mirror?.isConnected) {
    mirror = document.createElement('span');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;white-space:pre;pointer-events:none;';
    document.body.append(mirror);
  }
  const style = getComputedStyle(input);
  for (const property of TEXT_PROPERTIES) mirror.style[property] = style[property];
  mirror.textContent = text || '\u200b';
  return mirror;
};

const measure = (input: HTMLInputElement, text: string) => layout(input, text).getBoundingClientRect().width;

// Where the caret at `offset` sits, in px from the left of the input's content box.
// Read off the laid-out characters either side of it, rather than adding up the width
// of the text before it, so it lands right when right-to-left and left-to-right runs mix.
//
// Where runs of each direction meet, the two characters don't touch and the offset has
// two places on screen: the end of one run and the start of the other. Browsers draw
// the caret beside the character running in the field's direction (the run with the
// lower bidi level), checked against screenshots in Chromium and WebKit for single and
// word steps. A collapsed Range can't say which: Chromium reports both places, Firefox
// one, WebKit the other.
const caretOffset = (input: HTMLInputElement, offset: number) => {
  const rtl = getComputedStyle(input).direction === 'rtl';
  const text = input.value;
  const span = layout(input, text);
  const box = span.getBoundingClientRect();
  // Right-to-left text starts at the input's right edge; its caret room is on the left.
  const fromLeft = (x: number) => (rtl ? input.clientWidth - (box.right - x) : x - box.left);
  if (!text) return fromLeft(rtl ? box.right : box.left);

  // Whole graphemes, so an emoji, or a letter and its accents, is one character
  // (a lone accent's box sits on its letter's, not beside it).
  const starts: number[] = [];
  if ('Segmenter' in Intl) for (const { index } of new Intl.Segmenter().segment(text)) starts.push(index);
  // Firefox before 125: whole code points, so only accents count apart.
  else for (let i = 0; i < text.length; i += text.codePointAt(i)! > 0xffff ? 2 : 1) starts.push(i);
  const prev = (i: number) => {
    let found = -1;
    for (const start of starts) {
      if (start >= i) break;
      found = start;
    }
    return found;
  };
  const next = (i: number) => starts.find((start) => start > i) ?? (i < text.length ? text.length : text.length + 1);
  const range = document.createRange();
  const char = (from: number, to: number) => {
    if (from < 0 || to > text.length) return null;
    range.setStart(span.firstChild!, from);
    range.setEnd(span.firstChild!, to);
    return range.getBoundingClientRect();
  };
  // The edge two characters share on screen, if they touch. WebKit's boxes can sit a
  // pixel apart; where runs meet, a whole run lies between.
  const shared = (a: DOMRect | null, b: DOMRect | null) => {
    if (!a || !b) return null;
    if (Math.abs(a.right - b.left) < 2) return a.right;
    if (Math.abs(a.left - b.right) < 2) return a.left;
    return null;
  };
  const before = char(prev(offset), offset);
  const after = char(offset, next(offset));
  const touching = shared(before, after);
  if (touching !== null) return fromLeft(touching);

  // A run boundary, or an end of the text. A character runs right-to-left if the text
  // continues to its left (the one before it sits to its right), and is unknown when
  // that neighbour is itself across a boundary; unknown counts as the field's direction.
  const runsRtl = (rect: DOMRect, neighbour: DOMRect | null, neighbourIsNext: boolean) => {
    const edge = shared(rect, neighbour);
    return edge === null ? rtl : (edge === rect.left) === neighbourIsNext;
  };
  const sides = [];
  if (before) {
    const r = runsRtl(before, char(prev(prev(offset)), prev(offset)), false);
    sides.push({ place: r ? before.left : before.right, rtl: r });
  }
  if (after) {
    const r = runsRtl(after, char(next(offset), next(next(offset))), true);
    sides.push({ place: r ? after.right : after.left, rtl: r });
  }
  return fromLeft((sides.find((side) => side.rtl === rtl) ?? sides[0]!).place);
};

// The browser rounds the scroll range to whole pixels, and right-to-left it can sit
// a pixel off where the text says it should; anything hidden within that is at the edge.
const EDGE = 1;

// In px; an unset property reads as empty and takes the default.
const length = (style: CSSStyleDeclaration, name: string, fallback: number) => {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
};

// Server renderers import this module where HTMLElement doesn't exist.
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

export class SabiInput extends Base {
  #input: HTMLInputElement | null = null;
  #controller: AbortController | null = null;
  #inputController: AbortController | null = null;
  #frame = 0;
  #reveal = false;
  #anchor: number | null = null;

  connectedCallback() {
    this.#controller = new AbortController();
    const { signal } = this.#controller;
    // Children can arrive after the element is defined, and frameworks swap the input
    // or flip its `type` (a show-password toggle) or `dir`; follow all of it.
    const observer = new MutationObserver(() => this.#bind());
    observer.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'dir'] });
    signal.addEventListener('abort', () => observer.disconnect());

    this.addEventListener('click', (event) => {
      const input = this.#input;
      if (event.target !== this || !input || input.disabled) return;
      input.focus();
      if (this.#plain(input)) return;
      input.setSelectionRange(input.value.length, input.value.length);
      this.#syncNow(true);
    }, { signal });
    this.addEventListener('scroll', () => {
      this.#syncFades(length(getComputedStyle(this), '--sabi-fade-width', 22));
      this.#schedule(false);
    }, { passive: true, signal });
    const resizeObserver = new ResizeObserver(() => this.#schedule(document.activeElement === this.#input));
    resizeObserver.observe(this);
    signal.addEventListener('abort', () => resizeObserver.disconnect());
    document.fonts?.addEventListener('loadingdone', () => this.#schedule(false), { signal });

    this.#bind();
  }

  disconnectedCallback() {
    this.#controller?.abort();
    this.#inputController?.abort();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#input = null;
  }

  /** Re-measure after changes Sabi can't observe, such as a font swap on the input itself. */
  sync() {
    this.#schedule(document.activeElement === this.#input);
  }

  #bind() {
    const input = this.querySelector('input');
    if (input !== this.#input) {
      this.#inputController?.abort();
      this.#input = input;
      if (input) {
        this.#inputController = new AbortController();
        this.#attach(input, this.#inputController.signal);
      }
    }
    this.#schedule(false);
  }

  // Password values are never copied into the page, and fields without a readable
  // caret (`type="email"`, `number`) can't be followed: both stay a plain input.
  #plain(input: HTMLInputElement) {
    return input.type === 'password' || input.selectionStart === null;
  }

  #attach(input: HTMLInputElement, signal: AbortSignal) {
    this.#watchValue(input, signal);

    // Deferred, not synchronous: writing to the DOM mid-event can trigger observers
    // that re-render a controlled React input and revert the edit before React sees it.
    input.addEventListener('input', () => this.#schedule(true), { signal });
    input.addEventListener('focus', () => this.#schedule(true), { signal });
    input.addEventListener('blur', () => this.#schedule(false), { signal });
    // The browser moves the caret right after keydown; correcting in the next
    // animation frame lands before paint, so the caret never shows under a fade.
    // Safari centres a caret it scrolls into view; remember the settled scroll from
    // before the key so the correction moves only as far as the caret needs, as elsewhere.
    input.addEventListener('keydown', (event) => {
      if (this.#frame) this.#syncNow(false);
      // Native scrollLeft, which right-to-left counts from the right end, so text
      // typed mid-field (widening it on the left) doesn't shift what's in view.
      this.#anchor ??= this.scrollLeft;
      if (CARET_KEYS.has(event.key)) this.#schedule(true);
    }, { signal });
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === input) this.#schedule(input.selectionStart === input.selectionEnd);
    }, { signal });
    input.form?.addEventListener('reset', () => this.#schedule(false), { signal });
  }

  // Assigning `input.value` fires no event, which is how React, Vue and form
  // libraries update it. Wrap the setter on this one input so those updates re-measure.
  #watchValue(input: HTMLInputElement, signal: AbortSignal) {
    const own = Object.getOwnPropertyDescriptor(input, 'value');
    const base = own ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', {
      configurable: true,
      enumerable: base.enumerable,
      get: () => base.get!.call(input),
      set: (value: string) => {
        base.set!.call(input, value);
        this.#schedule(document.activeElement === input);
      },
    });
    signal.addEventListener('abort', () => {
      if (own) Object.defineProperty(input, 'value', own);
      else delete (input as { value?: string }).value;
    });
  }

  #schedule(reveal: boolean) {
    this.#reveal ||= reveal;
    if (!this.#frame) this.#frame = requestAnimationFrame(() => this.#flush());
  }

  #syncNow(reveal: boolean) {
    cancelAnimationFrame(this.#frame);
    this.#reveal ||= reveal;
    this.#flush();
  }

  #flush() {
    this.#frame = 0;
    const reveal = this.#reveal;
    this.#reveal = false;
    const anchor = this.#anchor;
    this.#anchor = null;
    const input = this.#input;
    if (!input) return;
    if (this.#plain(input)) {
      // Fits the strip and scrolls itself, with nothing to fade.
      input.style.width = '100%';
      this.scrollLeft = 0;
      this.#syncFades(length(getComputedStyle(this), '--sabi-fade-width', 22));
      this.removeAttribute('data-caret-hidden');
      return;
    }

    // An input with its own `dir` (often `dir="auto"`, which follows what's typed) sets
    // the field's direction (styles.css), so prefix, suffix and scrolling mirror with it.
    const direction = input.hasAttribute('dir') ? getComputedStyle(input).direction : null;
    if (this.getAttribute('data-dir') !== direction) {
      if (direction) this.setAttribute('data-dir', direction);
      else this.removeAttribute('data-dir');
    }

    const style = getComputedStyle(this);
    const rtl = style.direction === 'rtl';
    const gutter = length(style, '--sabi-edge-gutter', 8);
    const fadeWidth = length(style, '--sabi-fade-width', 22);
    const safeInset = Math.max(gutter, fadeWidth - length(style, '--sabi-caret-penetration', 4));

    // 2px of room for the caret at the end; whatever follows the input overlaps it (styles.css).
    input.style.width = `${measure(input, input.value || input.placeholder) + 2}px`;
    const maxScroll = Math.max(0, this.scrollWidth - this.clientWidth);
    const focused = document.activeElement === input;
    const { selectionStart: start, selectionEnd: end } = input;
    const collapsed = start !== null && start === end;

    // All positions below are physical, in px from the left of the scrolled content,
    // so the same rules serve both directions; only "start" and "end" swap sides.
    let caretX: number | null = null;
    if (focused && start !== null && end !== null) {
      const offset = !collapsed && input.selectionDirection === 'backward' ? start : end;
      const inputX = this.#inputX(input, rtl, maxScroll);
      caretX = inputX + caretOffset(input, offset);
      if (reveal) {
        const width = this.clientWidth;
        if (anchor !== null) this.scrollLeft = anchor;
        if (collapsed && offset === input.value.length) this.#setScrollX(rtl ? 0 : maxScroll, rtl, maxScroll);
        // At the start, show what's before the text (padding, prefix), but never
        // let a long prefix push the caret past a third of the way across the strip.
        else if (collapsed && offset === 0) {
          this.#setScrollX(rtl ? caretX - (width * 2) / 3 : caretX - width / 3, rtl, maxScroll);
        }
        // Then, wherever it is, keep the caret clear of any fade it would sit under,
        // rounding toward clear, since WebKit scrolls by whole pixels.
        const scrollX = this.#scrollX(rtl, maxScroll);
        if (scrollX > EDGE && caretX - scrollX < safeInset) this.#setScrollX(Math.floor(caretX - safeInset), rtl, maxScroll);
        else if (maxScroll - scrollX > EDGE && caretX - scrollX > width - safeInset) {
          this.#setScrollX(Math.ceil(caretX - width + safeInset), rtl, maxScroll);
        }
      }
    }
    mirror!.textContent = '';

    const { leftProgress, rightProgress, scrollX } = this.#syncFades(fadeWidth);

    // A caret scrolled into a fade by trackpad or wheel stays drawn through the
    // gradient and is hidden only where the text is fully faded out.
    const solid = length(style, '--sabi-fade-solid', 8);
    const viewportX = caretX === null ? null : caretX - scrollX;
    this.toggleAttribute('data-caret-hidden', collapsed && viewportX !== null && (
      viewportX < solid * leftProgress || viewportX > this.clientWidth - solid * rightProgress
    ));
  }

  // Scroll as px of content hidden past the left edge, in either direction.
  // Right-to-left scrolling starts at 0 and goes negative (CSSOM View, in every
  // current engine), so offset it by the scroll range, as MUI's scrollLeft helper does.
  #scrollX(rtl: boolean, maxScroll: number) {
    return rtl ? this.scrollLeft + maxScroll : this.scrollLeft;
  }

  #setScrollX(x: number, rtl: boolean, maxScroll: number) {
    const clamped = Math.min(maxScroll, Math.max(0, x));
    this.scrollLeft = rtl ? clamped - maxScroll : clamped;
  }

  // The input's left edge in the same coordinates. offsetLeft is measured from where
  // an unscrolled strip starts, which is its right end in right-to-left.
  #inputX(input: HTMLInputElement, rtl: boolean, maxScroll: number) {
    return input.offsetLeft + input.clientLeft + (rtl ? maxScroll : 0);
  }

  // Each fade's strength follows how much text is hidden on its side, so it
  // lands in the same frame as any scroll, jump or not, with nothing to animate.
  #syncFades(fadeWidth: number) {
    const rtl = getComputedStyle(this).direction === 'rtl';
    const maxScroll = Math.max(0, this.scrollWidth - this.clientWidth);
    const scrollX = this.#scrollX(rtl, maxScroll);
    const hiddenLeft = Math.max(0, scrollX);
    const hiddenRight = Math.max(0, maxScroll - scrollX);
    const leftProgress = Math.min(1, hiddenLeft / fadeWidth);
    const rightProgress = Math.min(1, hiddenRight / fadeWidth);
    this.style.setProperty('--sabi-fade-left-progress', String(leftProgress));
    this.style.setProperty('--sabi-fade-right-progress', String(rightProgress));
    this.toggleAttribute('data-fade-left', hiddenLeft > EDGE);
    this.toggleAttribute('data-fade-right', hiddenRight > EDGE);
    // The same, named by reading direction.
    this.toggleAttribute('data-fade-start', (rtl ? hiddenRight : hiddenLeft) > EDGE);
    this.toggleAttribute('data-fade-end', (rtl ? hiddenLeft : hiddenRight) > EDGE);
    return { leftProgress, rightProgress, scrollX };
  }
}

// Without cascade layers (before Chrome 99, Firefox 97, Safari 15.4) the stylesheet
// doesn't apply, so leave the input plain rather than half-enhanced.
export const define = () => {
  if (typeof customElements === 'undefined' || !('CSSLayerBlockRule' in globalThis) || customElements.get('sabi-input')) return;
  customElements.define('sabi-input', SabiInput);
};

declare global {
  interface HTMLElementTagNameMap {
    'sabi-input': SabiInput;
  }
}
