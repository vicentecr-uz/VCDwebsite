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

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-copy-code]');
  if (!button) return;
  void navigator.clipboard.writeText(button.dataset.copyCode!).then(() => {
    button.setAttribute('aria-label', 'Copied');
    button.title = 'Copied';
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    status.textContent = 'Code copied';
    button.append(status);
    window.setTimeout(() => {
      status.remove();
      button.setAttribute('aria-label', 'Copy');
      button.title = 'Copy';
    }, 1500);
  }).catch(() => {
    button.setAttribute('aria-label', 'Copy failed. Select the code to copy it.');
    button.title = 'Copy failed. Select the code to copy it.';
  });
});
