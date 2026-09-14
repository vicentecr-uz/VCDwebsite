import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const start = source.indexOf('    const flushPendingEditsForDocument = async');
const end = source.indexOf('    const persistPendingSectionInserts = async', start);
if (start < 0 || end < 0) throw new Error('Missing flush function boundaries');
const flushSource = source.slice(start, end);

type Pending = { id: string; kind: 'crop' | 'grid' | 'carousel' | 'caption'; payload: Record<string, unknown> };

function setup(initial: Pending[] = []) {
  const window = new Window();
  const pendingMedia = new Map(initial.map((change) => [change.id, change]));
  const calls: Array<{ kind: string; body?: any }> = [];
  const committed: string[][] = [];
  const savedItem: Record<string, unknown> = { src: 'old.png', variants: { desktop: { cx: 0.5 } }, captions: { desktop: 'Old' } };
  const savedSection = { type: 'imageCarousel', items: [savedItem] };
  let responseOk = true;
  const env: any = {
    window, Event: window.Event, CustomEvent: window.CustomEvent,
    pendingMedia,
    pendingSectionInserts: [], pendingSectionDeletes: [], pendingBlockConverts: [],
    persistPendingSectionInserts: async () => {},
    persistPendingSectionDeletes: async () => {},
    persistPendingBlockConverts: async () => {},
    persistPlaceholderFills: async () => {},
    persistDetailsRows: async () => {},
    dirtyTextStates: () => [], dirtySpacingStates: () => [], dirtyIntroHeightStates: () => [],
    updateActions: () => calls.push({ kind: 'update-actions' }),
    isPathPendingMediaChange: (change: Pending) => ['crop', 'grid', 'carousel', 'caption'].includes(change.kind),
    fetch: async (url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      calls.push({ kind: url, body });
      for (const crop of body.crops ?? []) Object.assign(savedItem, { src: crop.src, variants: crop.variants });
      for (const caption of body.captions ?? []) Object.assign(savedItem, { captions: caption.captions, captionStyle: caption.captionStyle });
      return { ok: responseOk, json: async () => (responseOk ? {} : { error: 'batch failed' }) };
    },
  };
  const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${flushSource}\nreturn flushPendingEditsForDocument;`);
  const flush = new Function('env', `with (env) { ${body} }`)(env) as (documentKey: string) => Promise<void>;
  window.addEventListener('vcd:dev-pending-committed', ((event: CustomEvent<{ ids: string[] }>) => {
    committed.push(event.detail.ids);
  }) as EventListener);
  return { window, pendingMedia, calls, committed, savedSection, env, flush, fail: () => { responseOk = false; } };
}

const media = (id: string, kind: Pending['kind'], document: string): Pending => ({
  id, kind, payload: { document, path: ['sections', 0, 'items', 0] },
});

test('flush persists replacement, crop, and caption before an append remount', async () => {
  const h = setup([
    { ...media('replacement', 'crop', 'project'), payload: { document: 'project', path: ['sections', 0, 'items', 0], src: 'replacement.png' } },
    media('carousel', 'carousel', 'project'),
    { ...media('caption', 'caption', 'project'), payload: { document: 'project', path: ['sections', 0, 'items', 0], captions: { desktop: 'Finder caption' }, captionStyle: 'white' } },
  ]);
  h.window.addEventListener('vcd:dev-before-save', () => {
    const crop = h.pendingMedia.get('replacement');
    if (crop) crop.payload.variants = { desktop: { cx: 0.25 } };
  });
  await h.flush('project');
  // The append caller remounts only after the flush promise resolves.
  const remounted = structuredClone(h.savedSection);
  remounted.items.push({ src: 'placeholder.svg' });
  expect(h.pendingMedia.size).toBe(0);
  expect(remounted.items[0]).toMatchObject({
    src: 'replacement.png', variants: { desktop: { cx: 0.25 } }, captions: { desktop: 'Finder caption' },
  });
  expect(h.calls[0].kind).toBe('/api/content-batch');
  expect(h.calls[0].body.crops).toHaveLength(1);
  expect(h.calls[0].body.crops[0].src).toBe('replacement.png');
  expect(h.calls[0].body.carousels).toHaveLength(1);
  expect(h.calls[0].body.captions).toHaveLength(1);
  expect(h.pendingMedia.size).toBe(0);
  expect(h.committed).toEqual([['replacement', 'carousel', 'caption']]);
  expect(h.calls.some(({ kind }) => kind === 'update-actions')).toBe(true);
});

test('flush submits only pending media for the requested document', async () => {
  const h = setup([media('one', 'crop', 'project'), media('other', 'caption', 'other')]);
  await h.flush('project');
  expect(h.calls[0].body.crops).toHaveLength(1);
  expect(h.pendingMedia.has('one')).toBe(false);
  expect(h.pendingMedia.has('other')).toBe(true);
});

test('failed media batch preserves pending edits and prevents append', async () => {
  const h = setup([media('crop', 'crop', 'project')]);
  h.fail();
  let appended = false;
  await expect((async () => { await h.flush('project'); appended = true; })()).rejects.toThrow('batch failed');
  expect(appended).toBe(false);
  expect(h.pendingMedia.has('crop')).toBe(true);
});

test('a concurrent newer entry is not acknowledged after an older batch succeeds', async () => {
  const h = setup([media('crop', 'crop', 'project')]);
  h.env.fetch = async () => {
    h.pendingMedia.set('crop', media('crop', 'crop', 'project'));
    return { ok: true, json: async () => ({}) };
  };
  await h.flush('project');
  expect(h.pendingMedia.has('crop')).toBe(true);
  expect(h.committed).toEqual([]);
});

test('a canceled before-save event aborts the append flush with a clear error', async () => {
  const h = setup([media('crop', 'crop', 'project')]);
  h.window.addEventListener('vcd:dev-before-save', (event) => event.preventDefault());
  await expect(h.flush('project')).rejects.toThrow('Finish the current image replacement first');
  expect(h.calls).toEqual([]);
  expect(h.pendingMedia.has('crop')).toBe(true);
});
