// Sabi snapshot b4277b2 (MIT, Vicente Cruz). Replace with sabi-input once published.
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const TEXT_PROPERTIES = ['font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontFeatureSettings', 'fontVariationSettings', 'textTransform', 'direction', 'unicodeBidi'] as const;

// A hidden copy of the input's text, laid out the way the input lays it out,
// including right-to-left and mixed-direction text (the mirror technique of
// textarea-caret-position, with the caret read from a Range instead of a marker).
let mirror: HTMLSpanElement | null = null;

const layout = (input: HTMLInputElement, text: string) => {
  if (!mirror?.isConnected) {
    mirror = document.createElement('span');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.cssText = 'position:absolute;top:0;left:0;visibility:hidden;white-space:pre;pointer-events:none;';
    document.body.append(mirror);
  }
  const style = getComputedStyle(input);
  for (const property of TEXT_PROPERTIES) mirror.style[property] = style[property];
  mirror.textContent = text || '\u200b';
  return mirror;
};

const measure = (input: HTMLInputElement, text: string) => layout(input, text).getBoundingClientRect().width;

// Where the caret at `offset` sits, in px from the left of the input's content box.
// Asking the browser, rather than adding up the width of the text before it, puts
// the caret in the right place when right-to-left and left-to-right runs are mixed.
//
// Where runs of each direction meet, one offset has two places on screen (the end of
// one run and the start of the other). Browsers draw the one beside where the caret
// just was, so a caret stepping into a word stays put rather than leaping to its far
// end; `near` is that last place, and without one the caret goes beside the character
// before (where typing leaves it).
//
// A collapsed Range reports these places, but each engine a different set (Chromium
// both, Firefox the one by the character before, WebKit the other), so both are also
// read off the characters beside the caret (each one's edge facing away from its own
// neighbour) to fill in whichever the engine left out; the Range's own places stay
// exact to the pixel.
const caretOffset = (input: HTMLInputElement, offset: number, near: number | null) => {
  const rtl = getComputedStyle(input).direction === 'rtl';
  const text = input.value;
  const span = layout(input, text);
  const box = span.getBoundingClientRect();
  // Right-to-left text starts at the input's right edge; its caret room is on the left.
  const fromLeft = (x: number) => (rtl ? input.clientWidth - (box.right - x) : x - box.left);
  if (!text) return fromLeft(rtl ? box.right : box.left);

  // Whole surrogate pairs, so an emoji is one character.
  const prev = (i: number) => (i > 1 && /[\uDC00-\uDFFF]/.test(text[i - 1]!) ? i - 2 : i - 1);
  const next = (i: number) => (/[\uD800-\uDBFF]/.test(text[i]!) ? i + 2 : i + 1);
  const range = document.createRange();
  const char = (from: number, to: number) => {
    if (from < 0 || to > text.length) return null;
    range.setStart(span.firstChild!, from);
    range.setEnd(span.firstChild!, to);
    return range.getBoundingClientRect();
  };
  const middle = (rect: DOMRect) => (rect.left + rect.right) / 2;
  // The edge away from the character's neighbour in the text, or, with none, the edge
  // toward the character across the caret.
  const edge = (rect: DOMRect | null, neighbour: DOMRect | null, across: DOMRect | null) => {
    if (!rect) return null;
    if (neighbour) return Math.abs(rect.left - middle(neighbour)) > Math.abs(rect.right - middle(neighbour)) ? rect.left : rect.right;
    if (across) return Math.abs(rect.left - middle(across)) < Math.abs(rect.right - middle(across)) ? rect.left : rect.right;
    return rtl ? rect.left : rect.right;
  };
  const before = char(prev(offset), offset);
  const after = char(offset, next(offset));
  const beforePlace = edge(before, char(prev(prev(offset)), prev(offset)), after);
  const afterPlace = edge(after, char(next(offset), next(next(offset))), before);
  range.setStart(span.firstChild!, offset);
  range.collapse(true);
  const reported = [...range.getClientRects()].filter((rect) => rect.height).map((rect) => rect.left);
  const places = [...reported, ...[beforePlace, afterPlace].filter((place) => place !== null && reported.every((r) => Math.abs(r - place) > 2))] as number[];
  const distance = (place: number) => Math.abs(near === null ? place - (beforePlace ?? afterPlace!) : fromLeft(place) - near);
  return fromLeft(places.reduce((best, place) => (distance(place) < distance(best) ? place : best)));
};

// The browser rounds the scroll range to whole pixels, and right-to-left it can sit
// a pixel off where the text says it should; anything hidden within that is at the edge.
const EDGE = 1;

const length = (style: CSSStyleDeclaration, name: string, fallback: number) =>
  Number.parseFloat(style.getPropertyValue(name)) || fallback;

// Server renderers import this module where HTMLElement doesn't exist.
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

export class SabiInput extends Base {
  #input: HTMLInputElement | null = null;
  #controller: AbortController | null = null;
  #frame = 0;
  #reveal = false;
  #anchor: number | null = null;
  #caret: number | null = null;

  connectedCallback() {
    this.#controller = new AbortController();
    const { signal } = this.#controller;
    const input = this.querySelector('input');
    if (input) return this.#attach(input, signal);
    // The element can be defined before its children are parsed.
    const observer = new MutationObserver(() => {
      const found = this.querySelector('input');
      if (!found) return;
      observer.disconnect();
      this.#attach(found, signal);
    });
    observer.observe(this, { childList: true, subtree: true });
    signal.addEventListener('abort', () => observer.disconnect());
  }

  disconnectedCallback() {
    this.#controller?.abort();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#input = null;
  }

  /** Re-measure after changes Sabi can't observe, such as a font swap on the input itself. */
  sync() {
    this.#schedule(document.activeElement === this.#input);
  }

  #attach(input: HTMLInputElement, signal: AbortSignal) {
    this.#input = input;
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
      if (this.#anchor === null) {
        const rtl = getComputedStyle(this).direction === 'rtl';
        this.#anchor = this.#scrollX(rtl, Math.max(0, this.scrollWidth - this.clientWidth));
      }
      if (CARET_KEYS.has(event.key)) this.#schedule(true);
    }, { signal });
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === input) this.#schedule(input.selectionStart === input.selectionEnd);
    }, { signal });
    input.form?.addEventListener('reset', () => this.#schedule(false), { signal });

    this.addEventListener('click', (event) => {
      if (event.target !== this || input.disabled) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      this.#syncNow(true);
    }, { signal });
    this.addEventListener('scroll', () => {
      this.#syncFades(length(getComputedStyle(this), '--sabi-fade-width', 22));
      this.#schedule(false);
    }, { passive: true, signal });

    const resizeObserver = new ResizeObserver(() => this.#schedule(document.activeElement === input));
    resizeObserver.observe(this);
    signal.addEventListener('abort', () => resizeObserver.disconnect());
    document.fonts?.addEventListener('loadingdone', () => this.#schedule(false), { signal });

    this.#schedule(false);
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

    // An input with its own `dir` (often `dir="auto"`, which follows what's typed)
    // sets the field's direction, so prefix, suffix and scrolling mirror with it.
    const direction = input.hasAttribute('dir') ? getComputedStyle(input).direction : '';
    if (this.style.direction !== direction) this.style.direction = direction;

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
    if (!focused) this.#caret = null;
    if (focused && start !== null && end !== null) {
      const offset = !collapsed && input.selectionDirection === 'backward' ? start : end;
      const inputX = this.#inputX(input, rtl, maxScroll);
      this.#caret = caretOffset(input, offset, this.#caret);
      caretX = inputX + this.#caret;
      if (reveal) {
        const width = this.clientWidth;
        if (anchor !== null) this.#setScrollX(anchor, rtl, maxScroll);
        if (collapsed && offset === input.value.length) this.#setScrollX(rtl ? 0 : maxScroll, rtl, maxScroll);
        // At the start, show what's before the text (padding, prefix), but never
        // let a long prefix push the caret past a third of the way across the strip.
        else if (collapsed && offset === 0) {
          this.#setScrollX(rtl ? Math.min(maxScroll, caretX - (width * 2) / 3) : caretX - width / 3, rtl, maxScroll);
        }
        // Then, wherever it is, keep the caret clear of any fade it would sit under.
        const scrollX = this.#scrollX(rtl, maxScroll);
        if (scrollX > EDGE && caretX - scrollX < safeInset) this.#setScrollX(caretX - safeInset, rtl, maxScroll);
        else if (maxScroll - scrollX > EDGE && caretX - scrollX > width - safeInset) {
          this.#setScrollX(caretX - width + safeInset, rtl, maxScroll);
        }
      }
    }

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

export const define = (name = 'sabi-input') => {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  customElements.define(name, class extends SabiInput {});
};

declare global {
  interface HTMLElementTagNameMap {
    'sabi-input': SabiInput;
  }
}
