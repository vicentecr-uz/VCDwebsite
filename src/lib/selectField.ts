export function initSelectFields() {
  const controller = new AbortController();
  const { signal } = controller;
  type Parts = {
    wrapper: HTMLElement;
    select: HTMLSelectElement;
    trigger: HTMLButtonElement;
    listbox: HTMLUListElement;
  };

  const getParts = (node: Element): Parts | null => {
    const wrapper = node.closest<HTMLElement>('.dev-field');
    const select = wrapper?.querySelector<HTMLSelectElement>('select.dev-select__native');
    const trigger = wrapper?.querySelector<HTMLButtonElement>('button.dev-select__trigger');
    const listbox = wrapper?.querySelector<HTMLUListElement>('ul.dev-select__listbox');
    if (!wrapper || !select || !trigger || !listbox) return null;
    return { wrapper, select, trigger, listbox };
  };

  const getOptionItems = (listbox: HTMLUListElement) =>
    [...listbox.querySelectorAll<HTMLLIElement>('li[role="option"]')];

  // DOM focus never leaves the trigger (select-only combobox model), so the
  // active-descendant pointer lives on the trigger, not the listbox.
  const setActiveOption = (parts: Parts, li: HTMLLIElement | null) => {
    const { trigger, listbox } = parts;
    getOptionItems(listbox).forEach((item) => item.classList.remove('is-active'));
    if (!li) {
      trigger.removeAttribute('aria-activedescendant');
      return;
    }
    li.classList.add('is-active');
    trigger.setAttribute('aria-activedescendant', li.id);
    li.scrollIntoView({ block: 'nearest' });
  };

  /**
   * Refreshes the trigger's visible label/icon and each option's
   * aria-selected from the native select's *current* value — the source of
   * truth stays the hidden select, this only repaints the view.
   */
  const syncFromSelect = ({ select, trigger, listbox }: Parts) => {
    const items = getOptionItems(listbox);
    let matched: HTMLLIElement | null = null;
    items.forEach((li) => {
      const isSelected = li.dataset.value === select.value;
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) matched = li;
    });

    const labelEl = trigger.querySelector<HTMLElement>('[data-dev-select-label]');
    const iconEl = trigger.querySelector<HTMLElement>('[data-dev-select-icon]');
    const fallbackLabel = select.options[select.selectedIndex]?.textContent || '';
    if (labelEl) {
      const matchedLabel = matched
        ? (matched as HTMLLIElement).querySelector('.dev-select__option-label')?.textContent
        : null;
      labelEl.textContent = matchedLabel || fallbackLabel;
    }
    if (iconEl) {
      const iconSource = matched
        ? (matched as HTMLLIElement).querySelector('.dev-select__option-icon')
        : null;
      iconEl.innerHTML = iconSource ? iconSource.innerHTML : '';
    }
  };

  /**
   * Rebuilds the popup's <li>s from the select's live <option>s. Consumers
   * like DevLogIssue populate options asynchronously after fetch via
   * replaceChildren — the popup has to follow along. Trusted icon SVG travels
   * with each native option so dynamic and static lists retain their icons.
   */
  const rebuildListboxFromSelect = (parts: Parts) => {
    const { select, trigger, listbox } = parts;
    const optionEls = [...select.querySelectorAll('option')];
    listbox.replaceChildren(
      ...optionEls.map((optionEl, index) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `${trigger.id}-option-${index}`;
        li.className = 'dev-btn dev-btn--ghost dev-btn--align-start dev-btn--fill dev-select__option';
        li.dataset.value = optionEl.value;
        li.setAttribute('aria-selected', optionEl.selected ? 'true' : 'false');
        if (optionEl.dataset.iconSvg) {
          const iconSpan = document.createElement('span');
          iconSpan.className = 'dev-select__option-icon';
          iconSpan.setAttribute('aria-hidden', 'true');
          iconSpan.innerHTML = optionEl.dataset.iconSvg;
          li.append(iconSpan);
        }
        const labelSpan = document.createElement('span');
        labelSpan.className = 'dev-select__option-label';
        labelSpan.textContent = optionEl.textContent || '';
        li.append(labelSpan);
        return li;
      }),
    );
    syncFromSelect(parts);
  };

  const instances = new Map<HTMLElement, {
    parts: Parts;
    observer: MutationObserver;
    valueDescriptor?: PropertyDescriptor;
    indexDescriptor?: PropertyDescriptor;
    typeaheadBuffer: string;
    typeaheadTimer: number;
  }>();

  const ensureInstance = (parts: Parts) => {
    if (instances.has(parts.wrapper)) return;
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) rebuildListboxFromSelect(parts);
      parts.trigger.disabled = parts.select.disabled;
    });
    observer.observe(parts.select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

    const { select } = parts;
    instances.set(parts.wrapper, {
      parts,
      observer,
      valueDescriptor: Object.getOwnPropertyDescriptor(select, 'value'),
      indexDescriptor: Object.getOwnPropertyDescriptor(select, 'selectedIndex'),
      typeaheadBuffer: '',
      typeaheadTimer: 0,
    });
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (descriptor?.get && descriptor?.set) {
      Object.defineProperty(select, 'value', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() { return descriptor.get.call(this); },
        set(next) {
          descriptor.set.call(this, next);
          syncFromSelect(parts);
        },
      });
    }
    const indexDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    if (indexDescriptor?.get && indexDescriptor?.set) {
      Object.defineProperty(select, 'selectedIndex', {
        configurable: true,
        enumerable: indexDescriptor.enumerable,
        get() { return indexDescriptor.get.call(this); },
        set(next) {
          indexDescriptor.set.call(this, next);
          syncFromSelect(parts);
        },
      });
    }
    syncFromSelect(parts);
  };

  /** Top of the painted glyph, not the span box. */
  const glyphTop = (el: Element) => {
    const node = el.firstChild;
    if (node instanceof Text && node.length >= 1) {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) return rect.top;
    }
    return el.getBoundingClientRect().top;
  };

  const glyphLeft = (el: Element) => {
    const node = el.firstChild;
    if (node instanceof Text && node.length >= 1) {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) return rect.left;
    }
    return el.getBoundingClientRect().left;
  };

  /**
   * Aligns the popup so its currently-active option sits exactly on top of
   * the visible grey field (`.dev-field__value`), not the trigger hitbox
   * (macOS-style popup-menu behaviour) — falls back to opening just below
   * the field when nothing is active. Clamps to an 8px viewport margin,
   * letting alignment degrade rather than overflow.
   */
  const positionListbox = (parts: Parts) => {
    const { trigger, listbox, select } = parts;
    const valueBox = trigger.closest('.dev-field__value') ?? trigger;
    const valueRect = valueBox.getBoundingClientRect();
    const margin = 8;
    const pad = 4;

    listbox.style.left = `${valueRect.left - pad}px`;
    listbox.style.width = `${Math.min(valueRect.width + pad * 2, window.innerWidth - margin * 2)}px`;
    listbox.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
    listbox.style.overflowY = 'auto';
    listbox.style.right = 'auto';
    listbox.style.bottom = 'auto';
    listbox.style.height = 'auto';

    const items = getOptionItems(listbox);
    const anchor = items.find((li) => li.classList.contains('is-active'))
      ?? items.find((li) => li.dataset.value === select.value)
      ?? null;

    const triggerLabel = trigger.querySelector('.dev-select__trigger-label');
    const optionLabel = anchor?.querySelector('.dev-select__option-label');
    if (anchor && triggerLabel && optionLabel) {
      listbox.style.top = `${valueRect.top}px`;
      let delta = glyphTop(triggerLabel) - glyphTop(optionLabel);
      listbox.style.top = `${valueRect.top + delta}px`;
      delta = glyphTop(triggerLabel) - glyphTop(optionLabel);
      listbox.style.top = `${parseFloat(listbox.style.top) + delta}px`;

      let leftDelta = glyphLeft(triggerLabel) - glyphLeft(optionLabel);
      listbox.style.left = `${parseFloat(listbox.style.left) + leftDelta}px`;
      leftDelta = glyphLeft(triggerLabel) - glyphLeft(optionLabel);
      listbox.style.left = `${parseFloat(listbox.style.left) + leftDelta}px`;
    } else if (anchor) {
      listbox.style.top = `${valueRect.top}px`;
      const delta = valueRect.top - anchor.getBoundingClientRect().top;
      listbox.style.top = `${valueRect.top + delta}px`;
    } else {
      listbox.style.top = `${valueRect.bottom + 4}px`;
    }

    let top = parseFloat(listbox.style.top);
    const listboxHeight = listbox.offsetHeight;
    if (top < margin) top = margin;
    if (top + listboxHeight > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - listboxHeight);
    }
    listbox.style.top = `${top}px`;
    listbox.style.left = `${Math.max(margin, Math.min(parseFloat(listbox.style.left), window.innerWidth - margin - listbox.offsetWidth))}px`;
  };

  const closeTimeouts = new WeakMap<HTMLUListElement, number>();
  const closeListeners = new WeakMap<HTMLUListElement, (event: TransitionEvent) => void>();

  const cancelPendingClose = (listbox: HTMLUListElement) => {
    const pending = closeTimeouts.get(listbox);
    if (pending != null) {
      window.clearTimeout(pending);
      closeTimeouts.delete(listbox);
    }
    const listener = closeListeners.get(listbox);
    if (listener) {
      listbox.removeEventListener('transitionend', listener);
      closeListeners.delete(listbox);
    }
  };

  const openListbox = (parts: Parts) => {
    const { trigger, listbox, select } = parts;
    if (trigger.disabled) return;
    ensureInstance(parts);
    if (listbox.classList.contains('is-closing')) {
      listbox.classList.remove('is-closing');
      cancelPendingClose(listbox);
    }
    listbox.classList.remove('is-keyboard');
    syncFromSelect(parts);
    listbox.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    const items = getOptionItems(listbox);
    const active = items.find((li) => li.dataset.value === select.value) ?? items[0] ?? null;
    setActiveOption(parts, active);
    positionListbox(parts);
  };

  const closeListbox = (parts: Parts, { returnFocus = true } = {}) => {
    const { trigger, listbox } = parts;
    if (!listbox.matches(':popover-open')) return;
    if (listbox.classList.contains('is-closing')) return;

    listbox.classList.add('is-closing');
    listbox.classList.remove('is-keyboard');
    trigger.setAttribute('aria-expanded', 'false');
    setActiveOption(parts, null);
    const instance = instances.get(parts.wrapper);
    if (instance) {
      window.clearTimeout(instance.typeaheadTimer);
      instance.typeaheadBuffer = '';
    }
    if (returnFocus) trigger.focus({ preventScroll: true });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelPendingClose(listbox);
      if (!listbox.classList.contains('is-closing')) return;
      if (listbox.matches(':popover-open')) listbox.hidePopover();
      listbox.classList.remove('is-closing');
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== 'opacity') return;
      finish();
    };

    listbox.addEventListener('transitionend', onTransitionEnd);
    closeListeners.set(listbox, onTransitionEnd);
    const timeoutId = window.setTimeout(finish, 200);
    closeTimeouts.set(listbox, timeoutId);
  };

  const commitOption = (parts: Parts, li: HTMLLIElement) => {
    const { select } = parts;
    const nextValue = li.dataset.value ?? '';
    if (select.value !== nextValue) {
      select.value = nextValue;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncFromSelect(parts);
  };

  const initAllInstances = () => {
    document.querySelectorAll<HTMLSelectElement>('select.dev-select__native').forEach((select) => {
      const parts = getParts(select);
      if (parts) ensureInstance(parts);
    });
  };
  initAllInstances();

  // Click: toggle the trigger, commit an option choice, or (via a plain
  // click landing outside any select) nothing — outside-close is pointerdown.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const trigger = target.closest<HTMLButtonElement>('.dev-select__trigger');
    if (trigger) {
      const parts = getParts(trigger);
      if (!parts || parts.trigger.disabled) return;
      ensureInstance(parts);
      syncFromSelect(parts);
      if (!parts.listbox.matches(':popover-open') || parts.listbox.classList.contains('is-closing')) openListbox(parts);
      else closeListbox(parts, { returnFocus: false });
      return;
    }

    const option = target.closest<HTMLLIElement>('.dev-select__listbox li[role="option"]');
    if (option) {
      const parts = getParts(option);
      if (!parts) return;
      commitOption(parts, option);
      closeListbox(parts);
    }
  }, { signal });

  // Hover moves the same single highlight as arrows; commit stays click/Enter.
  document.addEventListener('pointerover', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const option = target.closest<HTMLLIElement>('.dev-select__option');
    if (!option) return;
    const parts = getParts(option);
    if (!parts || !parts.listbox.matches(':popover-open')) return;
    if (parts.listbox.classList.contains('is-keyboard')) return;
    setActiveOption(parts, option);
  }, { signal });

  // Once arrows (or type-ahead) own the highlight, ignore hover until the
  // pointer actually moves again — native menu behaviour.
  document.addEventListener('pointermove', (event) => {
    if (event.movementX === 0 && event.movementY === 0) return;
    const target = event.target;
    document.querySelectorAll<HTMLUListElement>('.dev-select__listbox').forEach((listbox) => {
      if (!listbox.matches(':popover-open')) return;
      if (!listbox.classList.contains('is-keyboard')) return;
      listbox.classList.remove('is-keyboard');
      if (!(target instanceof Element)) return;
      const option = target.closest<HTMLLIElement>('.dev-select__option');
      if (!option || !listbox.contains(option)) return;
      const parts = getParts(option);
      if (parts) setActiveOption(parts, option);
    });
  }, { signal });

  // Pointerdown outside the trigger and options closes without committing.
  // popover="manual" has no native light-dismiss; clicks on listbox padding
  // or leftover UA inset chrome are not options, so they close too.
  // Option pointerdown must preventDefault so the trigger keeps focus —
  // otherwise blur closes the popup before click can commit.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (target instanceof Element) {
      const option = target.closest('.dev-select__option');
      const optionListbox = option?.closest<HTMLUListElement>('.dev-select__listbox');
      if (option && optionListbox?.matches(':popover-open')) {
        event.preventDefault();
      }
    }
    document.querySelectorAll<HTMLUListElement>('.dev-select__listbox').forEach((listbox) => {
      if (!listbox.matches(':popover-open')) return;
      const parts = getParts(listbox);
      if (!parts) return;
      const onTrigger = target instanceof Node && parts.trigger.contains(target);
      const onOption = target instanceof Element && listbox.contains(target) && target.closest('.dev-select__option');
      if (!onTrigger && !onOption) closeListbox(parts, { returnFocus: false });
    });
  }, { capture: true, signal });

  // Belt for click-away: if the trigger blurs and focus is not moving into
  // the trigger or the listbox, close so leftover open state cannot steal
  // arrow keys (which would otherwise scroll the page).
  document.addEventListener('focusout', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches('.dev-select__trigger')) return;
    const parts = getParts(target);
    if (!parts || !parts.listbox.matches(':popover-open')) return;
    const related = event.relatedTarget;
    if (related instanceof Element && related.closest('.dev-select__option')) return;
    if (related instanceof Node && (parts.trigger.contains(related) || parts.listbox.contains(related))) {
      return;
    }
    closeListbox(parts, { returnFocus: false });
  }, { signal });

  // Reposition every open popup on scroll (capture, so a scroll inside any
  // ancestor container is caught too) and on viewport resize.
  const repositionOpenListboxes = () => {
    document.querySelectorAll<HTMLUListElement>('.dev-select__listbox:popover-open').forEach((listbox) => {
      const parts = getParts(listbox);
      if (parts) positionListbox(parts);
    });
  };
  window.addEventListener('scroll', repositionOpenListboxes, { capture: true, signal });
  window.addEventListener('resize', repositionOpenListboxes, { signal });

  // Trigger keys. Focus never leaves the trigger, so both closed (open the
  // popup) and open (move / commit / type-ahead) share this one listener.
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest<HTMLButtonElement>('.dev-select__trigger');
    if (!trigger || trigger.disabled) return;
    const parts = getParts(trigger);
    if (!parts) return;

    if (!parts.listbox.matches(':popover-open') || parts.listbox.classList.contains('is-closing')) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openListbox(parts);
      }
      return;
    }

    const items = getOptionItems(parts.listbox);
    const activeIndex = items.findIndex((item) => item.classList.contains('is-active'));

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        parts.listbox.classList.add('is-keyboard');
        setActiveOption(parts, items[Math.min(items.length - 1, activeIndex + 1)] ?? null);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        parts.listbox.classList.add('is-keyboard');
        setActiveOption(parts, items[Math.max(0, activeIndex - 1)] ?? null);
        break;
      }
      case 'Home': {
        event.preventDefault();
        parts.listbox.classList.add('is-keyboard');
        setActiveOption(parts, items[0] ?? null);
        break;
      }
      case 'End': {
        event.preventDefault();
        parts.listbox.classList.add('is-keyboard');
        setActiveOption(parts, items[items.length - 1] ?? null);
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const active = items[activeIndex];
        if (active) commitOption(parts, active);
        closeListbox(parts);
        break;
      }
      case 'Escape': {
        event.preventDefault();
        closeListbox(parts);
        break;
      }
      case 'Tab': {
        // Commit whatever's highlighted, close, and let Tab move on natively
        // — the next focusable element in the document is the right target,
        // not something we should compute ourselves.
        const active = items[activeIndex];
        if (active) commitOption(parts, active);
        closeListbox(parts, { returnFocus: false });
        break;
      }
      default: {
        if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const instance = instances.get(parts.wrapper);
          if (!instance) break;
          window.clearTimeout(instance.typeaheadTimer);
          instance.typeaheadBuffer += event.key.toLowerCase();
          const match = items.find((item) =>
            (item.querySelector('.dev-select__option-label')?.textContent || '')
              .trim()
              .toLowerCase()
              .startsWith(instance.typeaheadBuffer),
          );
          parts.listbox.classList.add('is-keyboard');
          if (match) setActiveOption(parts, match);
          instance.typeaheadTimer = window.setTimeout(() => {
            instance.typeaheadBuffer = '';
          }, 500);
        }
      }
    }
  }, { signal });

  // A hidden, tabindex=-1 select can still be focus()ed programmatically by
  // consumer code (DevLogIssue does this on validation failure) — redirect
  // that focus onto the trigger so the user actually sees something happen.
  // This also runs syncFromSelect for any consumer that set .value directly
  // without dispatching change (DevLogIssue does this too).
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const select = target.closest<HTMLSelectElement>('select.dev-select__native');
    if (select) {
      const parts = getParts(select);
      if (parts && document.activeElement !== parts.trigger) parts.trigger.focus();
      return;
    }

    const trigger = target.closest<HTMLButtonElement>('.dev-select__trigger');
    if (trigger) {
      const parts = getParts(trigger);
      if (parts) {
        ensureInstance(parts);
        syncFromSelect(parts);
      }
    }
  }, { signal });

  // Any change on the hidden select — ours or a consumer's own dispatch —
  // keeps the trigger's view in sync.
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!target.classList.contains('dev-select__native')) return;
    const parts = getParts(target);
    if (parts) syncFromSelect(parts);
  }, { signal });

  const dismissImmediately = (parts: Parts) => {
    cancelPendingClose(parts.listbox);
    if (parts.listbox.matches(':popover-open')) parts.listbox.hidePopover();
    parts.listbox.classList.remove('is-closing', 'is-keyboard');
    parts.trigger.setAttribute('aria-expanded', 'false');
    setActiveOption(parts, null);
    const instance = instances.get(parts.wrapper);
    if (instance) {
      window.clearTimeout(instance.typeaheadTimer);
      instance.typeaheadBuffer = '';
    }
  };

  document.addEventListener('reset', (event) => {
    queueMicrotask(() => {
      if (signal.aborted || event.defaultPrevented) return;
      for (const { parts } of instances.values()) {
        if (parts.select.form !== event.target) continue;
        dismissImmediately(parts);
        syncFromSelect(parts);
      }
    });
  }, { signal });

  const releaseInstance = (wrapper: HTMLElement) => {
    const instance = instances.get(wrapper);
    if (!instance) return;
    dismissImmediately(instance.parts);
    instance.observer.disconnect();
    const { select } = instance.parts;
    for (const [key, descriptor] of [['value', instance.valueDescriptor], ['selectedIndex', instance.indexDescriptor]] as const) {
      if (descriptor) Object.defineProperty(select, key, descriptor);
      else Reflect.deleteProperty(select, key);
    }
    instances.delete(wrapper);
  };

  const treeObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const selects = node.matches('select.dev-select__native')
          ? [node]
          : node.querySelectorAll('select.dev-select__native');
        for (const select of selects) {
          const parts = getParts(select);
          if (parts) ensureInstance(parts);
        }
      }
    }
    for (const wrapper of instances.keys()) {
      if (!wrapper.isConnected) releaseInstance(wrapper);
    }
  });
  treeObserver.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    controller.abort();
    treeObserver.disconnect();
    for (const wrapper of instances.keys()) releaseInstance(wrapper);
  };

}
