import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { initFieldOverflow } from '../../src/lib/fieldOverflow.js';

test('shared fields wrap supported inputs, fade read-only values and select labels, and clean up', () => {
  const window = new Window();
  const names = ['document', 'MutationObserver', 'ResizeObserver', 'AbortController'] as const;
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: window[name] }));
  try {
    window.document.body.innerHTML = '<div class="dev-field"><div class="dev-field__value"><input aria-hidden="true" name="status" value="draft"></div></div>';
    const hiddenField = window.document.querySelector('.dev-field')!;
    const hiddenInput = hiddenField.querySelector('input')!;
    const parent = hiddenInput.parentElement;
    const dispose = initFieldOverflow(hiddenField, { manageMarkup: false })!;
    expect(hiddenInput.parentElement).toBe(parent);
    expect(hiddenField.querySelector('sabi-input')).toBeNull();
    dispose();
    const disposeNative = initFieldOverflow(hiddenField)!;
    expect(hiddenInput.parentElement).toBe(parent);
    expect(hiddenField.querySelector('sabi-input')).toBeNull();
    disposeNative();
    window.document.body.innerHTML = '<div class="dev-field"><div class="dev-field__value"></div></div>';
    const field = window.document.querySelector('.dev-field')!;
    const value = field.firstElementChild!;
    const supported = ['text', 'url', 'search', 'tel', 'password'];
    const native = ['email', 'number'];
    const controls = [...supported, ...native].map(type => {
      const input = window.document.createElement('input');
      input.type = type;
      input.style.width = '100%';
      value.append(input);
      return input;
    });
    const optOut = window.document.createElement('input');
    optOut.setAttribute('data-native-text-field', '');
    value.append(optOut);
    const cleanup = initFieldOverflow(field)!;
    expect(optOut.parentElement).toBe(value);
    for (const input of controls) {
      if (supported.includes(input.type)) {
        expect(input.parentElement?.localName).toBe('sabi-input');
        input.style.width = '500px';
      } else {
        expect(input.parentElement).toBe(value);
        expect(input.classList.contains('dev-field-overflow')).toBe(false);
      }
    }
    cleanup();
    for (const input of controls) {
      expect(input.parentElement).toBe(value);
      expect(input.style.width).toBe('100%');
    }

    for (const content of ['A long read-only value', '<button><span class="dev-select__trigger-label">A long selected value</span></button>']) {
      window.document.body.innerHTML = `<div class="dev-field"><div class="dev-field__value">${content}</div></div>`;
      const field = window.document.querySelector('.dev-field')!;
      const cleanup = initFieldOverflow(field)!;
      const container = field.querySelector<HTMLElement>('.dev-field__value')!;
      const track = field.querySelector('.dev-select__trigger-label, .dev-field__overflow-content')!;
      Object.defineProperties(track, { scrollWidth: { value: 300 }, clientWidth: { value: 100 } });
      track.dispatchEvent(new window.Event('scroll'));
      expect(container.style.maskImage).toBe('');
      expect(track.getAttribute('style')).toContain('calc(100% - 22px)');
      track.scrollLeft = 200;
      track.dispatchEvent(new window.Event('scroll'));
      expect(track.getAttribute('style')).toContain('transparent, #000 22px');
      expect(track.getAttribute('style')).not.toContain('calc(100% - 22px)');
      cleanup();
      expect(track.classList.contains('dev-field-overflow')).toBe(false);
      expect((track as HTMLElement).style.maskImage).toBe('');
      expect(container.textContent).toContain('value');
      expect(container.querySelector('.dev-field__overflow-content')).toBeNull();
    }
  } finally {
    names.forEach((name, i) => originals[i] ? Object.defineProperty(globalThis, name, originals[i]!) : Reflect.deleteProperty(globalThis, name));
    window.happyDOM.abort();
  }
});
