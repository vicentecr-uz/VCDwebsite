export type GapSpacingValue = 'related' | 'group' | 'section' | 'major' | 'none';

type GapSpacingOption = { value: GapSpacingValue; label: string; title: string };

const options: GapSpacingOption[] = [
  { value: 'related', label: 'unit', title: 'Related · --space-unit' },
  { value: 'group', label: '4em', title: 'Group · 4em' },
  { value: 'section', label: '8em', title: 'Section · 8em' },
  { value: 'major', label: '12em', title: 'Major · 12em' },
];

const noneOption: GapSpacingOption = { value: 'none', label: '0', title: 'None · 0' };

export const spacingButtonsHtml = (pageTop: boolean, pageBottom: boolean) =>
  (pageTop || pageBottom ? [noneOption, ...options] : options)
    .map((option) => `
      <button
        type="button"
        class="dev-spacing-control__btn"
        data-dev-spacing-option="${option.value}"
        title="${option.title}"
        aria-label="${option.title}"
      >
        <span class="dev-spacing-control__mark dev-spacing-control__mark--${option.value}" aria-hidden="true"></span>
        <span class="dev-spacing-control__label">${option.label}</span>
      </button>
    `)
    .join('');
