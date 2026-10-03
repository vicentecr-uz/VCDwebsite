import { initTextField } from './devTextField.js';

export function initFieldOverflow(field) {
  const value = field.querySelector('.dev-field__value');
  if (!value) return;
  const controller = new AbortController();
  const tracked = new Map();
  const inputs = new Map();
  const wrapped = new Map();
  const sync = () => {
    for (const track of tracked.keys()) {
      const left = track.scrollLeft > .5;
      const right = track.scrollWidth - track.clientWidth - track.scrollLeft > .5;
      track.style.maskImage = !left && !right ? '' : `linear-gradient(to right, ${left ? 'transparent, #000 22px' : '#000'}, ${right ? '#000 calc(100% - 22px), transparent' : '#000'})`;
    }
  };
  const resize = new ResizeObserver(sync);
  const discover = () => {
    for (const input of value.querySelectorAll('input')) {
      if (!['text', 'search', 'url', 'tel'].includes(input.type) || input.closest('.dev-text-field')) continue;
      const root = document.createElement('div');
      root.className = 'dev-text-field dev-text-field--native';
      const track = document.createElement('div');
      track.className = 'dev-text-field__track';
      const content = document.createElement('div');
      content.className = 'dev-text-field__content';
      const measure = document.createElement('span');
      measure.className = 'dev-text-field__measure';
      measure.setAttribute('aria-hidden', 'true');
      input.before(root);
      content.append(input);
      track.append(content);
      root.append(track, measure);
      wrapped.set(root, input);
    }
    for (const [root, cleanup] of inputs) {
      if (value.contains(root)) continue;
      cleanup();
      inputs.delete(root);
    }
    for (const root of value.querySelectorAll('.dev-text-field')) {
      if (!inputs.has(root)) inputs.set(root, initTextField(root));
    }
    const candidates = [...value.querySelectorAll('.dev-select__trigger-label, .base-ui-select-value, input[type="email"], input[type="password"], input[type="number"], [data-field-overflow]')];
    if (!value.querySelector('input, textarea, button, select, .dev-text-field')) candidates.push(value);
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
    for (const cleanup of inputs.values()) cleanup();
    for (const [root, input] of wrapped) root.replaceWith(input);
    for (const track of tracked.keys()) {
      track.classList.remove('dev-field-overflow');
      track.style.maskImage = '';
    }
  };
  document.addEventListener('astro:before-swap', cleanup, { once: true, signal: controller.signal });
  return cleanup;
}
