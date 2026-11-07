// Segmented options that show one panel each: [data-options] holds buttons with
// aria-pressed and, in the same order, [data-option-panel] elements.
document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-options] .dev-segmented .dev-btn');
  if (!button) return;
  const root = button.closest<HTMLElement>('[data-options]')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.dev-segmented .dev-btn')];
  const panels = root.querySelectorAll<HTMLElement>('[data-option-panel]');
  const index = buttons.indexOf(button);
  buttons.forEach((each, i) => each.setAttribute('aria-pressed', String(i === index)));
  panels.forEach((panel, i) => { panel.hidden = i !== index; });
});

const copyFeedback = new WeakMap<HTMLButtonElement, number>();

document.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-copy-code]');
  if (!button) return;
  const status = button.querySelector('[role="status"]')!;

  let copied = false;
  try {
    await navigator.clipboard.writeText(button.dataset.copyCode!);
    copied = true;
  } catch {
    // The clipboard can be unavailable or deny access.
  }

  window.clearTimeout(copyFeedback.get(button));
  button.toggleAttribute('data-copied', copied);
  const label = copied ? 'Copied' : 'Copy failed. Select the code to copy it.';
  button.setAttribute('aria-label', label);
  button.title = label;
  status.textContent = copied ? 'Code copied' : label;

  if (!copied) return;
  copyFeedback.set(button, window.setTimeout(() => {
    copyFeedback.delete(button);
    button.removeAttribute('data-copied');
    button.setAttribute('aria-label', 'Copy');
    button.title = 'Copy';
    status.textContent = '';
  }, 1750));
});
