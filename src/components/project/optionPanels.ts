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
  if (button) void navigator.clipboard.writeText(button.dataset.copyCode!);
});
