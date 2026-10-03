import { useEffect, useState } from 'react';
import { Select } from '@base-ui/react/select';
import {
  initEditorSelectBridge,
  type EditorSelectOption,
  type EditorSelectSnapshot,
} from '../../lib/editorSelect';
import './base-ui.css';

const grouped = (options: EditorSelectOption[]) => {
  const groups: Array<{ label: string; options: EditorSelectOption[] }> = [];
  for (const option of options) {
    const label = option.group || '';
    if (groups.at(-1)?.label !== label) groups.push({ label, options: [] });
    groups.at(-1)!.options.push(option);
  }
  return groups;
};
// Base UI reserves the empty string for no selection; encode every native value to avoid collisions.
const encodeValue = (value: string | null) => value === null ? null : `vcd:${value}`;
const decodeValue = (value: string | null) => value === null ? null : value.slice(4);

export default function EditorSelect({
  triggerId,
  label,
  options: initialOptions,
  disabled: initialDisabled = false,
  value: initialValue,
}: {
  triggerId: string;
  label: string;
  options: EditorSelectOption[];
  disabled?: boolean;
  value?: string | null;
}) {
  const [snapshot, setSnapshot] = useState<EditorSelectSnapshot>({
    options: initialOptions,
    value: initialValue === undefined ? initialOptions[0]?.value ?? null : initialValue,
    disabled: initialDisabled,
  });
  const [selectionReturnedFocus, setSelectionReturnedFocus] = useState(false);
  const [menuValue, setMenuValue] = useState(snapshot.value);

  useEffect(() => {
    const trigger = document.getElementById(triggerId);
    const select = trigger?.closest('.dev-field')?.querySelector<HTMLSelectElement>('select[data-dev-editor-select]');
    if (!select) return;
    return initEditorSelectBridge(select, setSnapshot);
  }, [triggerId]);

  const commit = (encodedNext: string | null) => {
    const next = decodeValue(encodedNext);
    if (next == null) return;
    const trigger = document.getElementById(triggerId);
    const select = trigger?.closest('.dev-field')?.querySelector<HTMLSelectElement>('select[data-dev-editor-select]');
    if (!select || (select.selectedIndex >= 0 && select.value === next)) return;
    select.value = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const selected = snapshot.options.find((option) => option.value === snapshot.value);

  return (
    <Select.Root
      items={snapshot.options.map(({ label: itemLabel, value: itemValue }) => ({ label: itemLabel, value: encodeValue(itemValue)! }))}
      value={encodeValue(snapshot.value)}
      disabled={snapshot.disabled}
      onValueChange={commit}
      onOpenChange={(open, details) => {
        if (open) setMenuValue(snapshot.value);
        setSelectionReturnedFocus(!open && details.reason === 'item-press');
      }}
    >
      <Select.Trigger
        id={triggerId}
        aria-label={label}
        data-selection-returned-focus={selectionReturnedFocus || undefined}
        onBlur={() => setSelectionReturnedFocus(false)}
        className="dev-field__input dev-field__input--select dev-select__trigger"
        data-editor-select-trigger
      >
        {selected?.iconSvg && <span className="dev-select__trigger-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: selected.iconSvg }} />}
        <Select.Value className="base-ui-select-value dev-select__trigger-label" placeholder={snapshot.emptyLabel} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="base-ui-select-positioner" alignItemWithTrigger>
          <Select.Popup className="base-ui-select-popup" data-editor-select-popup data-editor-select-owner={triggerId}>
            <Select.List>
              {grouped(snapshot.options).map(({ label: group, options }, index) => (
                <Select.Group className="base-ui-select-group" key={index}>
                  {group && <Select.GroupLabel className="base-ui-select-group-label">{group}</Select.GroupLabel>}
                  {options.map((option) => (
                    <Select.Item key={option.value} value={encodeValue(option.value)!} className="base-ui-select-item" disabled={option.disabled}>
                      {option.iconSvg && <span className="dev-select__option-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: option.iconSvg }} />}
                      <Select.ItemText className="base-ui-select-item__text">{option.label}</Select.ItemText>
                      <span className="base-ui-select-check" aria-hidden="true" style={{ visibility: option.value === menuValue ? 'visible' : 'hidden' }}>✓</span>
                    </Select.Item>
                  ))}
                </Select.Group>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
