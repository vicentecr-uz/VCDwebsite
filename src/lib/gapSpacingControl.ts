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

export const GAP_ENTRY_RADIUS = 8;
export const GAP_RETENTION_RADIUS = 24;
export const GAP_INTENT_DELAY = 140;
export const GAP_FAST_POINTER = 0.18;

export function pinGapToolbar(control: HTMLElement) {
  if (control.dataset.gapPinnedTop == null) {
    const rect = control.getBoundingClientRect();
    control.dataset.gapPinnedTop = String(rect.top);
    control.dataset.gapPinnedLeft = String(rect.left);
    control.dataset.gapPinnedWidth = String(rect.width);
  }
  control.style.position = 'fixed';
  control.style.top = `${control.dataset.gapPinnedTop}px`;
  control.style.left = `${control.dataset.gapPinnedLeft}px`;
  control.style.right = 'auto';
  control.style.width = `${control.dataset.gapPinnedWidth}px`;
  control.style.transform = 'none';
  control.dataset.gapTopPinned = 'true';
}

export function unpinGapToolbar(control: HTMLElement) {
  for (const property of ['position', 'top', 'left', 'right', 'width', 'transform']) control.style.removeProperty(property);
  delete control.dataset.gapTopPinned;
  delete control.dataset.gapPinnedTop;
  delete control.dataset.gapPinnedLeft;
  delete control.dataset.gapPinnedWidth;
}
