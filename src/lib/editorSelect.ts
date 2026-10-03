export type EditorSelectOption = {
  value: string;
  label: string;
  group?: string;
  iconSvg?: string;
  disabled?: boolean;
};

export type EditorSelectSnapshot = {
  options: EditorSelectOption[];
  value: string | null;
  disabled: boolean;
  emptyLabel?: string;
};

const readSnapshot = (select: HTMLSelectElement): EditorSelectSnapshot => ({
  options: [...select.options].map((option) => ({
    value: option.value,
    label: option.getAttribute('label') ?? option.textContent ?? '',
    iconSvg: option.dataset.iconSvg,
    disabled: option.disabled || (option.parentElement?.tagName === 'OPTGROUP' && (option.parentElement as HTMLOptGroupElement).disabled),
    group: option.parentElement?.tagName === 'OPTGROUP'
      ? (option.parentElement as HTMLOptGroupElement).label
      : undefined,
  })),
  value: select.selectedIndex >= 0 ? select.value : null,
  disabled: select.disabled,
  emptyLabel: select.dataset.emptyLabel || undefined,
});

export const initEditorSelectBridge = (
  select: HTMLSelectElement,
  onSync: (snapshot: EditorSelectSnapshot) => void,
) => {
  const controller = new AbortController();
  const { signal } = controller;
  const valueDescriptor = Object.getOwnPropertyDescriptor(select, 'value');
  const indexDescriptor = Object.getOwnPropertyDescriptor(select, 'selectedIndex');
  const prototype = (globalThis.HTMLSelectElement?.prototype || Object.getPrototypeOf(select)) as typeof HTMLSelectElement.prototype;
  const nativeValue = Object.getOwnPropertyDescriptor(prototype, 'value');
  const nativeIndex = Object.getOwnPropertyDescriptor(prototype, 'selectedIndex');
  const sync = () => onSync(readSnapshot(select));
  let disposed = false;

  const wrap = <T>(name: 'value' | 'selectedIndex', descriptor: PropertyDescriptor | undefined, native: PropertyDescriptor | undefined) => {
    if (!native?.get || !native.set) return;
    Object.defineProperty(select, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? native.enumerable,
      get() { return native.get!.call(this); },
      set(next: T) {
        native.set!.call(this, next);
        sync();
      },
    });
  };
  wrap('value', valueDescriptor, nativeValue);
  wrap('selectedIndex', indexDescriptor, nativeIndex);

  const form = select.form;
  form?.addEventListener('reset', () => queueMicrotask(() => { if (!disposed) sync(); }), { signal });
  select.addEventListener('change', sync, { signal });
  const observer = new MutationObserver(sync);
  observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label', 'value', 'selected', 'data-icon-svg', 'data-empty-label'] });
  sync();

  return () => {
    disposed = true;
    controller.abort();
    observer.disconnect();
    if (valueDescriptor) Object.defineProperty(select, 'value', valueDescriptor);
    else Reflect.deleteProperty(select, 'value');
    if (indexDescriptor) Object.defineProperty(select, 'selectedIndex', indexDescriptor);
    else Reflect.deleteProperty(select, 'selectedIndex');
  };
};
