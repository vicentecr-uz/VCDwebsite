import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { bindImageReplaceControls } from '../../src/lib/imageReplaceControls';

function setup() {
  const win = new Window();
  const root = win.document.createElement('div');
  root.innerHTML = '<div data-crop-replace-drop tabindex="0"><button data-crop-replace-choose>File system</button><input data-crop-replace-file type="file"></div>';
  const input = root.querySelector<HTMLInputElement>('[data-crop-replace-file]')!;
  const choose = root.querySelector<HTMLButtonElement>('[data-crop-replace-choose]')!;
  const files: File[] = [];
  let pickerOpens = 0;
  input.click = () => {
    pickerOpens++;
    input.dispatchEvent(new win.Event('click', { bubbles: true }));
  };
  bindImageReplaceControls(root, { onFile: (file) => { if (file) files.push(file); }, signal: new AbortController().signal });
  return { win, root, input, choose, files, get pickerOpens() { return pickerOpens; } };
}

test('visual choose forwards to the native input once without recursive bubbling', () => {
  const h = setup();
  let rootClicks = 0;
  h.root.addEventListener('click', () => { rootClicks++; });
  h.choose.click();
  expect(h.pickerOpens).toBe(1);
  expect(rootClicks).toBe(0);
});

test('native input change forwards the selected file and clears the value', () => {
  const h = setup();
  const file = new h.win.File(['image'], 'chosen.png', { type: 'image/png' });
  Object.defineProperty(h.input, 'files', { configurable: true, value: [file] });
  h.input.dispatchEvent(new h.win.Event('change'));
  expect(h.files).toEqual([file]);
  expect(h.input.value).toBe('');
});
