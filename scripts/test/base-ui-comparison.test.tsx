import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import BaseUiExample from '../../src/components/base-ui/BaseUiExample';
import { comparisons } from '../../src/lib/baseUiComparison';

const render = (kind: string) => {
  const document = new Window().document;
  document.body.innerHTML = renderToStaticMarkup(<BaseUiExample kind={kind} />);
  return document;
};

describe('Base UI study server rendering', () => {
  test('every migrated or retained React example produces markup', () => {
    for (const { id } of comparisons) {
      if (id === 'dev-panel-drag') continue;
      expect(render(id).body.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  test('text inputs retain editable initial values and disabled state', () => {
    const document = render('text-field');
    const inputs = [...document.querySelectorAll('input')];
    expect(inputs.map(input => input.value)).toEqual(['Project name', 'project-name', 'Unavailable']);
    expect(inputs[0].readOnly).toBe(false);
    expect(inputs[1].readOnly).toBe(false);
    expect(inputs[2].disabled).toBe(true);
    const prefixTrack = inputs[1].closest('.dev-text-field__track');
    expect(prefixTrack?.textContent).toContain('example.com/');
    expect(inputs[0].closest('.dev-text-field')).not.toBeNull();
    for (const input of inputs) expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
  });

  test('select supplies a named form value and a labelled disabled trigger', () => {
    const document = render('select-field');
    expect(document.querySelector<HTMLInputElement>('input[name="status"]')?.value).toBe('draft');
    const disabled = document.querySelector<HTMLButtonElement>('button[disabled]');
    expect(disabled?.textContent).toContain('Draft');
    expect(document.querySelector(`label[for="${disabled?.id}"]`)?.textContent).toBe('Disabled');
  });

  test('selection groups start with one checked choice', () => {
    for (const [kind, value] of [['segmented-control', 'Left'], ['viewport-selector', 'Desktop']]) {
      const document = render(kind);
      const checked = document.querySelectorAll('[role="radio"][aria-checked="true"]');
      expect(checked.length).toBe(1);
      expect(checked[0].textContent).toBe(value);
    }
  });

  test('textarea label is associated with its control', () => {
    const document = render('text-area');
    const textarea = document.querySelector('textarea')!;
    expect(document.querySelector(`label[for="${textarea.id}"]`)?.textContent).toBe('Notes');
    expect(textarea.value).toContain('First line of notes.');
  });
});
