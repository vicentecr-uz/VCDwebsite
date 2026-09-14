import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/DevTextEditor.astro', import.meta.url), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const slice = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function updateFlow({ pending = false, draft = false, saved = true, failure = false, busy = false } = {}) {
  const events: string[] = [];
  const window = {
    scrollY: 40,
    dispatchEvent(event: CustomEvent) {
      if (event.type === 'vcd:dev-has-draft') event.detail.dirty = draft;
      if (event.type === 'vcd:dev-mode-request') events.push(event.detail.active ? 'edit' : 'leave');
      return true;
    },
    location: { reload() { events.push('reload'); } },
  };
  let callback: () => void;
  const input = {
    branchUpdateButton: { addEventListener(_type: string, fn: () => void) { callback = fn; } },
    window,
    CustomEvent,
    sessionStorage: { setItem() {}, removeItem() {} },
    refreshPublishState() {},
    refreshBranchUpdateState() {},
    updateActions() {},
    hasPendingEdits: () => pending,
    async performSave() { events.push('save'); if (saved) { pending = false; draft = false; return {}; } return null; },
    async waitForAuthoringIdle() { events.push('idle'); },
    async fetch() { events.push('request'); return { ok: true }; },
    async readApiJson() { return { ok: true, requestId: 'one' }; },
    async waitForBranchUpdate(id: string) { events.push(`wait:${id}`); if (failure) throw new Error('Conflict restored'); },
    editorSignal: undefined,
    pageHistory: { busy: false },
    SCROLL_RESTORE_KEY: 'scroll',
  };
  const code = `let branchUpdateAvailable = true, branchUpdateBusy = false, branchUpdateMessage = '', actionsBusy = ${busy}, stickyStatus = '';
${slice("    branchUpdateButton.addEventListener('click'", '    const performSave =')}
return () => ({branchUpdateBusy, branchUpdateMessage, actionsBusy});`;
  const state = new Function(...Object.keys(input), transpiler.transformSync(code))(...Object.values(input));
  callback!();
  return { events, state };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('saved unpublished work updates without publishing or an unnecessary save', async () => {
  const { events } = updateFlow(); await settle();
  expect(events).toEqual(['leave', 'idle', 'request', 'wait:one', 'reload']);
});

test('pending editor and tuner drafts save before the authoring lease is released', async () => {
  const { events } = updateFlow({ pending: true, draft: true }); await settle();
  expect(events).toEqual(['save', 'leave', 'idle', 'request', 'wait:one', 'reload']);
});

test('failed or cancelled saves never request an update or reload', async () => {
  const { events, state } = updateFlow({ draft: true, saved: false }); await settle();
  expect(events).toEqual(['save', 'edit']);
  expect(state().branchUpdateMessage).toContain('Save did not complete');
  expect(state().actionsBusy).toBe(false);
});

test('an update conflict restores Edit mode and retains the error', async () => {
  const { events, state } = updateFlow({ failure: true }); await settle();
  expect(events).toEqual(['leave', 'idle', 'request', 'wait:one', 'edit']);
  expect(state().branchUpdateMessage).toBe('Conflict restored');
  expect(state().branchUpdateBusy).toBe(false);
});

test('another save or publish in progress prevents an update request', async () => {
  const { events } = updateFlow({ busy: true }); await settle();
  expect(events).toEqual([]);
});

test('polling rejects matching failure and ignores success for a different request', async () => {
  let calls = 0;
  const states = [{ id: 'old', state: 'succeeded' }, { id: 'current', state: 'failed', message: 'Restored drafts' }];
  const code = slice('    const waitForBranchUpdate =', "    branchUpdateButton.addEventListener('click'");
  const wait = new Function('sleep', 'fetch', 'readApiJson', transpiler.transformSync(`${code}\nreturn waitForBranchUpdate;`))(
    async () => {}, async () => ({ ok: true }), async () => ({ update: states[calls++] }),
  );
  await expect(wait('current')).rejects.toThrow('Restored drafts');
  expect(calls).toBe(2);
});
