/** Single selection for a SegmentedControl (or any button group) in a report prototype. */
export function choiceGroup(group: Element | null, onChange: (value: string, button: HTMLButtonElement) => void) {
  const buttons = () => [...(group?.querySelectorAll<HTMLButtonElement>('button[data-value]') ?? [])];
  const select = (value: string, notify = true) => {
    for (const button of buttons()) {
      const on = button.dataset.value === value;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-pressed', String(on));
      if (on && notify) onChange(value, button);
    }
  };
  group?.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-value]');
    if (button && !button.classList.contains('is-selected')) select(button.dataset.value!);
  });
  return select;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
