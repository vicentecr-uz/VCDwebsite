export function initFieldOverflow(field, { manageMarkup = true } = {}) {
  const value = field.querySelector('.dev-field__value');
  if (!value) return;
  const controller = new AbortController();
  const tracked = new Map();
  const wrapped = new Map();
  let readOnlyTrack;
  const sync = () => {
    for (const track of tracked.keys()) {
      const left = track.scrollLeft > .5;
      const right = track.scrollWidth - track.clientWidth - track.scrollLeft > .5;
      track.style.maskImage = !left && !right ? '' : `linear-gradient(to right, ${left ? 'transparent, #000 22px' : '#000'}, ${right ? '#000 calc(100% - 22px), transparent' : '#000'})`;
    }
  };
  const resize = new ResizeObserver(sync);
  const discover = () => {
    for (const input of manageMarkup ? value.querySelectorAll('input') : []) {
      if (input.hidden || input.getAttribute('aria-hidden') === 'true') continue;
      if (!['text', 'search', 'url', 'tel', 'password'].includes(input.type) || input.closest('sabi-input')) continue;
      const root = document.createElement('sabi-input');
      root.className = 'dev-text-field';
      input.before(root);
      root.append(input);
      wrapped.set(root, { input, width: input.style.width });
    }
    for (const [root, { input }] of wrapped) {
      if (root.contains(input) && value.contains(root)) continue;
      if (!root.hasChildNodes()) root.remove();
      wrapped.delete(root);
    }
    const candidates = [...value.querySelectorAll('.dev-select__trigger-label, .base-ui-select-value, [data-field-overflow]')];
    if (manageMarkup && !value.querySelector('input, textarea, button, select, .dev-text-field, [data-field-overflow]')) {
      if (!readOnlyTrack || !value.contains(readOnlyTrack)) {
        readOnlyTrack = document.createElement('span');
        readOnlyTrack.className = 'dev-field__overflow-content';
        readOnlyTrack.append(...value.childNodes);
        value.append(readOnlyTrack);
      }
      candidates.push(readOnlyTrack);
    }
    for (const track of tracked.keys()) {
      if (candidates.includes(track)) continue;
      resize.unobserve(track);
      track.classList.remove('dev-field-overflow');
      track.style.maskImage = '';
      tracked.delete(track);
    }
    for (const track of candidates) {
      if (tracked.has(track)) continue;
      tracked.set(track, true);
      track.classList.add('dev-field-overflow');
      track.addEventListener('scroll', sync, { passive: true, signal: controller.signal });
      resize.observe(track);
    }
    sync();
  };
  const changes = new MutationObserver(discover);
  changes.observe(value, { childList: true, subtree: true, characterData: true });
  discover();
  const cleanup = () => {
    controller.abort();
    resize.disconnect();
    changes.disconnect();
    for (const [root, { input, width }] of wrapped) {
      if (input.parentElement !== root) continue;
      root.replaceWith(input);
      input.style.width = width;
    }
    if (readOnlyTrack?.parentNode === value) readOnlyTrack.replaceWith(...readOnlyTrack.childNodes);
    for (const track of tracked.keys()) {
      track.classList.remove('dev-field-overflow');
      track.style.maskImage = '';
    }
  };
  document.addEventListener('astro:before-swap', cleanup, { once: true, signal: controller.signal });
  return cleanup;
}
