import { isAcceptedImageFile } from './imageUpload.mjs';

export function bindImageReplaceControls(root: HTMLElement, options: { onFile: (file: File | undefined) => void; signal: AbortSignal }) {
  const { onFile, signal } = options;
  const drop = root.querySelector<HTMLElement>('[data-crop-replace-drop]');
  const choose = root.querySelector<HTMLButtonElement>('[data-crop-replace-choose]');
  const input = root.querySelector<HTMLInputElement>('[data-crop-replace-file]');
  if (!drop || !choose || !input) return;
  const isControl = (event: Event) => event.target instanceof Element && Boolean(event.target.closest('button, input'));
  drop.addEventListener('click', (event) => { if (!isControl(event)) drop.focus(); }, { signal });
  drop.addEventListener('dblclick', (event) => { if (!isControl(event)) input.click(); }, { signal });
  drop.addEventListener('keydown', (event) => { if (!isControl(event) && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); input.click(); } }, { signal });
  drop.addEventListener('paste', (event) => { const file = [...(event.clipboardData?.items ?? [])].map((item) => item.kind === 'file' ? item.getAsFile() : null).find((item): item is File => Boolean(item && isAcceptedImageFile(item))); if (!file) return; event.preventDefault(); onFile(file); }, { signal });
  choose.addEventListener('click', (event) => { event.stopPropagation(); input.click(); }, { signal });
  input.addEventListener('change', () => { const file = input.files?.[0]; input.value = ''; onFile(file); }, { signal });
  drop.addEventListener('dragenter', (event) => { event.preventDefault(); event.stopPropagation(); drop.classList.add('is-dragover'); }, { signal });
  drop.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; drop.classList.add('is-dragover'); }, { signal });
  drop.addEventListener('dragleave', (event) => { event.stopPropagation(); drop.classList.remove('is-dragover'); }, { signal });
  drop.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); drop.classList.remove('is-dragover'); onFile(event.dataTransfer?.files?.[0]); }, { signal });
}
