const syncTextFieldTrail = (root, input, measure) => {
  const trail = root.querySelector('[data-text-field-trail]');
  const rootStyle = getComputedStyle(root);
  const edgeGutter = Number.parseFloat(
    rootStyle.getPropertyValue('--dev-text-field-edge-gutter'),
  ) || 8;
  const fadeWidth = Number.parseFloat(
    rootStyle.getPropertyValue('--dev-text-field-fade-width'),
  ) || 22;
  if (!(trail instanceof HTMLElement) || trail.hidden) {
    root.style.setProperty('--dev-text-field-trail-end', '0px');
    return { trailWidth: 0, trailRight: 0 };
  }
  const textEndX = input.offsetLeft + measureInputText(input, measure, input.value);
  trail.style.left = `${textEndX}px`;
  const trailWidth = trail.getBoundingClientRect().width;
  root.style.setProperty(
    '--dev-text-field-trail-end',
    `${trailWidth + Math.max(0, fadeWidth - edgeGutter)}px`,
  );
  return { trailWidth, trailRight: textEndX + trailWidth };
};

const measureInputText = (input, measure, value) => {
  const style = getComputedStyle(input);
  measure.style.font = style.font;
  measure.style.letterSpacing = style.letterSpacing;
  measure.textContent = value || '\u200b';
  return measure.getBoundingClientRect().width;
};

const getTextFieldCaretGeometry = (root, input, track, measure, caretOffset) => {
  const rootStyle = getComputedStyle(root);
  const edgeGutter = Number.parseFloat(
    rootStyle.getPropertyValue('--dev-text-field-edge-gutter'),
  ) || 8;
  const fadeWidth = Number.parseFloat(
    rootStyle.getPropertyValue('--dev-text-field-fade-width'),
  ) || 22;
  const caretPenetration = Number.parseFloat(
    rootStyle.getPropertyValue('--dev-text-field-caret-penetration'),
  ) || 4;
  const caretSafeInset = Math.max(edgeGutter, fadeWidth - caretPenetration);
  const caretWidth = measureInputText(input, measure, input.value.slice(0, caretOffset));
  const caretX = input.offsetLeft + caretWidth;

  return {
    scrollOwner: track,
    edgeGutter,
    caretSafeInset,
    caretStartX: caretX,
    caretEndX: caretX,
    maxScroll: Math.max(0, track.scrollWidth - track.clientWidth),
  };
};

const syncTextFieldVisuals = (root) => {
  if (!(root instanceof HTMLElement)) return;
  const track = root.querySelector('.dev-text-field__track');
  const input = root.querySelector('input');
  const measure = root.querySelector('.dev-text-field__measure');
  if (!(track instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(measure instanceof HTMLElement)) return;
  const rootStyle = getComputedStyle(root);
  const edgeGutter = Number.parseFloat(
    rootStyle.getPropertyValue('--dev-text-field-edge-gutter'),
  ) || 8;
  const displayedTextWidth = measureInputText(input, measure, input.value || input.placeholder);
  const { trailWidth, trailRight } = syncTextFieldTrail(root, input, measure);
  const scrollOwner = track;
  const textStartX = input.offsetLeft;
  const textEndX = textStartX + displayedTextWidth;
  const overflowRight = Math.max(textEndX, trailRight);
  const start = input.selectionStart;
  const end = input.selectionEnd;
  root.classList.toggle('is-fade-left', scrollOwner.scrollLeft > 0.5);
  root.classList.toggle(
    'is-fade-right',
    overflowRight - scrollOwner.scrollLeft > scrollOwner.clientWidth - edgeGutter + 0.5,
  );

  if (document.activeElement !== input || start === null || end === null || start !== end) {
    root.classList.remove('is-caret-outside');
    return;
  }
  const {
    caretSafeInset,
    caretStartX,
    caretEndX,
  } = getTextFieldCaretGeometry(root, input, track, measure, start);
  const leftCaretInset = root.classList.contains('is-fade-left')
    ? caretSafeInset
    : edgeGutter;
  const rightCaretInset = root.classList.contains('is-fade-right')
    ? caretSafeInset
    : edgeGutter;
  const viewportCaretStartX = caretStartX - scrollOwner.scrollLeft;
  const atTextEnd = start === end && start === input.value.length;
  const viewportRightEdge = (trailWidth > 0 && atTextEnd ? trailRight : caretEndX)
    - scrollOwner.scrollLeft;
  root.classList.toggle(
    'is-caret-outside',
    viewportCaretStartX < leftCaretInset - 0.5
      || viewportRightEdge > scrollOwner.clientWidth - rightCaretInset + 0.5,
  );
};

const measureTextFieldInput = (root) => {
  if (!(root instanceof HTMLElement)) return;
  const input = root.querySelector('input');
  const measure = root.querySelector('.dev-text-field__measure');
  if (!(input instanceof HTMLInputElement) || !(measure instanceof HTMLElement)) return;
  const width = measureInputText(input, measure, input.value || input.placeholder);
  input.style.width = `${Math.ceil(width + 2)}px`;
};

const revealTextFieldCaret = (root) => {
  if (!(root instanceof HTMLElement)) return;
  const track = root.querySelector('.dev-text-field__track');
  const input = root.querySelector('input');
  const measure = root.querySelector('.dev-text-field__measure');
  if (!(track instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(measure instanceof HTMLElement)) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  if (start === null || end === null) return;
  const caretOffset = start === end || input.selectionDirection !== 'backward' ? end : start;
  const isCollapsed = start === end;
  const isTextStart = isCollapsed
    && caretOffset === 0
    && !root.classList.contains('dev-text-field--prefix');
  const isTextEnd = isCollapsed && caretOffset === input.value.length;
  const {
    scrollOwner,
    edgeGutter,
    caretSafeInset,
    caretStartX,
    caretEndX,
  } = getTextFieldCaretGeometry(root, input, track, measure, caretOffset);
  const { trailWidth, trailRight } = syncTextFieldTrail(root, input, measure);
  if (isTextStart) scrollOwner.scrollLeft = 0;
  if (isTextEnd) scrollOwner.scrollLeft = Math.max(0, scrollOwner.scrollWidth - scrollOwner.clientWidth);
  const leftInset = root.classList.contains('is-fade-left') && !isTextStart
    ? caretSafeInset
    : edgeGutter;
  const rightInset = root.classList.contains('is-fade-right') && !isTextEnd
    ? caretSafeInset
    : edgeGutter;
  const caretViewportStartX = caretStartX - scrollOwner.scrollLeft;
  const rightEdge = trailWidth > 0 && isTextEnd ? trailRight : caretEndX;
  const rightEdgeViewportX = rightEdge - scrollOwner.scrollLeft;
  const maxScroll = Math.max(0, scrollOwner.scrollWidth - scrollOwner.clientWidth);
  const clampScroll = (value) => Math.min(maxScroll, Math.max(0, value));
  if (caretViewportStartX < leftInset) scrollOwner.scrollLeft = clampScroll(caretStartX - leftInset);
  else if (rightEdgeViewportX > scrollOwner.clientWidth - rightInset) {
    scrollOwner.scrollLeft = clampScroll(rightEdge - scrollOwner.clientWidth + rightInset);
  }
};

const syncTextFieldLayout = (root, revealCaret = false) => {
  measureTextFieldInput(root);
  if (revealCaret) revealTextFieldCaret(root);
  syncTextFieldVisuals(root);
};

const syncTextFieldCaret = (root) => {
  revealTextFieldCaret(root);
  syncTextFieldVisuals(root);
};

const placeTextFieldCaretAtEnd = (input) => {
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
};

export const initTextField = (root) => {
  if (!(root instanceof HTMLElement) || root.dataset.devTextFieldInitialized) return () => {};
  root.dataset.devTextFieldInitialized = 'true';
  const input = root.querySelector('input');
  const track = root.querySelector('.dev-text-field__track');
  const content = root.querySelector('.dev-text-field__content');
  const field = root.closest('.dev-field');
  if (!(input instanceof HTMLInputElement) || !(track instanceof HTMLElement) || !(content instanceof HTMLElement) || !(field instanceof HTMLElement)) {
    delete root.dataset.devTextFieldInitialized;
    return () => {};
  }
  const controller = new AbortController();
  const { signal } = controller;
  let frame = 0;
  let pendingLayout = false;
  let pendingReveal = false;
  let selectionChangedSinceCaretKey = false;
  let synchronousSelection = null;
  const flush = () => {
    const layout = pendingLayout;
    const reveal = pendingReveal;
    frame = 0;
    pendingLayout = false;
    pendingReveal = false;
    if (layout) syncTextFieldLayout(root, reveal);
    else if (reveal) syncTextFieldCaret(root);
    else syncTextFieldVisuals(root);
  };
  const schedule = (layout = false, reveal = false) => {
    pendingLayout ||= layout;
    pendingReveal ||= reveal;
    if (frame) return;
    frame = requestAnimationFrame(flush);
  };
  const syncNow = (layout = false, reveal = false) => {
    cancelAnimationFrame(frame);
    pendingLayout ||= layout;
    pendingReveal ||= reveal;
    flush();
  };
  field.addEventListener('click', (event) => {
    if (
      !(event instanceof MouseEvent)
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.altKey
      || event.shiftKey
      || input.disabled
      || event.target === input
    ) return;
    placeTextFieldCaretAtEnd(input);
    syncNow(false, true);
  }, { signal });
  input.addEventListener('input', () => {
    syncNow(true, true);
  }, { signal });
  input.addEventListener('change', () => schedule(true, document.activeElement === input), { signal });
  input.addEventListener('click', () => {
    const hasCollapsedCaret = input.selectionStart !== null
      && input.selectionStart === input.selectionEnd;
    if (hasCollapsedCaret) syncNow(false, true);
    else schedule(false, false);
  }, { signal });
  input.addEventListener('select', () => {
    const hasCollapsedCaret = input.selectionStart !== null
      && input.selectionStart === input.selectionEnd;
    schedule(false, hasCollapsedCaret);
  }, { signal });
  input.addEventListener('focus', () => schedule(true, true), { signal });
  const handleSelectionChange = () => {
    if (document.activeElement !== input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (synchronousSelection && start === synchronousSelection.start && end === synchronousSelection.end) {
      synchronousSelection = null;
      return;
    }
    synchronousSelection = null;
    selectionChangedSinceCaretKey = true;
    const hasCollapsedCaret = start !== null && start === end;
    syncNow(false, hasCollapsedCaret);
  };
  document.addEventListener('selectionchange', handleSelectionChange, { signal });
  const isCaretKey = (event) => event.key === 'ArrowLeft'
    || event.key === 'ArrowRight'
    || event.key === 'Home'
    || event.key === 'End';
  const graphemeSegmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
  input.addEventListener('keydown', (event) => {
    if (
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      || event.shiftKey
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.defaultPrevented
      || event.isComposing
      || input.disabled
      || input.readOnly
    ) {
      if (isCaretKey(event)) selectionChangedSinceCaretKey = false;
      return;
    }
    const inputStyle = getComputedStyle(input);
    if (inputStyle.direction !== 'ltr' || inputStyle.writingMode !== 'horizontal-tb') {
      selectionChangedSinceCaretKey = false;
      return;
    }
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start === null || end === null) return;
    let next = event.key === 'ArrowLeft' ? start : end;
    if (start === end) {
      if (!graphemeSegmenter) {
        selectionChangedSinceCaretKey = false;
        return;
      }
      const segmenterDirection = event.key === 'ArrowLeft' ? 'left' : 'right';
      const segments = graphemeSegmenter.segment(input.value);
      if (segmenterDirection === 'left') {
        for (const { index } of segments) {
          if (index >= start) break;
          next = index;
        }
      } else {
        next = input.value.length;
        for (const { index } of segments) {
          if (index > start) {
            next = index;
            break;
          }
        }
      }
    }
    event.preventDefault();
    synchronousSelection = { start: next, end: next };
    input.setSelectionRange(next, next);
    selectionChangedSinceCaretKey = true;
    syncNow(false, true);
    return;
  }, { signal });
  input.addEventListener('keyup', (event) => {
    if (!isCaretKey(event)) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (selectionChangedSinceCaretKey) return;
      const hasCollapsedCaret = input.selectionStart !== null
        && input.selectionStart === input.selectionEnd;
      syncNow(false, hasCollapsedCaret);
    } else if (!selectionChangedSinceCaretKey) {
      const hasCollapsedCaret = input.selectionStart !== null
        && input.selectionStart === input.selectionEnd;
      syncNow(false, hasCollapsedCaret);
    } else {
      schedule(false, false);
    }
  }, { signal });
  track.addEventListener('scroll', () => schedule(false, false), { passive: true, signal });
  root.addEventListener('vcd:text-field-sync', (event) => {
    if (event.target === input) schedule(true, document.activeElement === input);
  }, { signal });
  const resizeObserver = 'ResizeObserver' in window
    ? new ResizeObserver(() => schedule(true, document.activeElement === input))
    : null;
  resizeObserver?.observe(track);
  resizeObserver?.observe(content);
  const cleanup = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    pendingLayout = false;
    pendingReveal = false;
    synchronousSelection = null;
    document.removeEventListener('selectionchange', handleSelectionChange);
    resizeObserver?.disconnect();
    controller.abort();
    delete root.dataset.devTextFieldInitialized;
  };
  document.addEventListener('astro:before-swap', cleanup, { once: true, signal });
  schedule(true, false);
  return cleanup;
};
