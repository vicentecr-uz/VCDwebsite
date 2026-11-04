import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import EditorSelect from '../../src/components/base-ui/EditorSelect';

describe('editor select server rendering', () => {
  const options = [{ value: '', label: 'None' }, { value: 'draft', label: 'Draft' }];
  test('native empty value renders its option label', () => {
    const html = renderToStaticMarkup(<EditorSelect triggerId="editor-empty" label="Status" options={options} value="" />);
    expect(html).toContain('None');
    expect(html).toContain('aria-label="Status"');
    expect(html).not.toContain('name="status"');
  });
  test('selected label and disabled state survive server rendering', () => {
    const document = new Window().document;
    document.body.innerHTML = renderToStaticMarkup(<EditorSelect triggerId="editor-disabled" label="Status" options={options} value="draft" disabled />);
    expect(document.querySelector('button')?.textContent).toBe('Draft');
    expect(document.querySelector('button')?.disabled).toBe(true);
  });
});
