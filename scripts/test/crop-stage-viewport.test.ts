import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/ProjectImageCropTuner.astro', import.meta.url), 'utf8');
const start = source.indexOf('    const refreshCover = () => {');
const end = source.indexOf("    pageScope.listen(previewImage, 'load', refreshCover);", start);
if (start < 0 || end < 0) throw new Error('Missing crop refresh boundaries');
const refreshSource = `${source.slice(start, end)}\nreturn refreshCover;`;

function harness() {
  const env: any = {
    editingSession: true,
    pageStage: null,
    selectedViewport: 'mobile',
    gate: false,
    editedImage: { naturalWidth: 0 },
    draft: { cx: 0.4, cy: 0.6, w: 0.75 },
    viewportGateOk: () => env.gate,
    mountCalls: 0,
    unmountCalls: 0,
    renderCalls: 0,
    mountPageStage: () => {
      env.mountCalls += 1;
      env.pageStage = { stage: {} };
    },
    unmountPageStage: (options: { immediate?: boolean }) => {
      expect(options.immediate).toBe(true);
      env.unmountCalls += 1;
      env.pageStage = null;
    },
    renderDraft: () => { env.renderCalls += 1; },
  };
  const refresh = new Function('env', `with (env) { ${refreshSource} }`)(env) as () => void;
  return { env, refresh };
}

test('refreshCover mounts and unmounts the page stage as the selected viewport crosses the gate', () => {
  const h = harness();
  h.refresh();
  expect(h.env.mountCalls).toBe(0);
  expect(h.env.unmountCalls).toBe(0);

  h.env.gate = true;
  h.refresh();
  h.refresh();
  expect(h.env.mountCalls).toBe(1);
  expect(h.env.unmountCalls).toBe(0);
  expect(h.env.selectedViewport).toBe('mobile');
  expect(h.env.draft).toEqual({ cx: 0.4, cy: 0.6, w: 0.75 });

  h.env.gate = false;
  h.refresh();
  expect(h.env.unmountCalls).toBe(1);
  h.env.gate = true;
  h.refresh();
  expect(h.env.mountCalls).toBe(2);
  expect(h.env.unmountCalls).toBe(1);
});

test('refreshCover leaves inactive sessions alone and waits for the image before rendering drafts', () => {
  const h = harness();
  h.env.editingSession = false;
  h.env.gate = true;
  h.refresh();
  expect(h.env.mountCalls).toBe(0);
  expect(h.env.renderCalls).toBe(0);

  h.env.editingSession = true;
  h.env.editedImage.naturalWidth = 1200;
  h.refresh();
  expect(h.env.mountCalls).toBe(1);
  expect(h.env.renderCalls).toBe(1);
});
