import { afterAll, expect, test } from 'bun:test';
import { createAct, Stopped, type ActEnv } from '../../src/lib/stageshow/act';
import type { Keys } from '../../src/lib/stageshow/keys';

const originalFrame = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
afterAll(() => {
  globalThis.requestAnimationFrame = originalFrame;
  globalThis.cancelAnimationFrame = originalCancel;
});

function keyAction() {
  const controller = new AbortController();
  const keysRef = { current: { id: 0, caps: [], show: false, down: false } as Keys };
  const states: Keys[] = [];
  const env: ActEnv<Record<string, never>> = {
    rootRef: { current: null }, cursorRef: { current: null },
    pos: { current: { x: 0, y: 0 } }, hovered: { current: null },
    kindRef: { current: 'pointer' }, keysRef,
    dragging: { current: false }, autoUsed: { current: false },
    autoRef: { current: null }, scaleRef: { current: 1 },
    speed: 100, layout: 'wide',
    resolve: () => ({ x: 0, y: 0 }), place: () => {}, remeasure: () => {}, ripple: () => {},
    setState: () => {}, setKind: () => {}, setLastKeys: () => {},
    setKeys: (value) => { keysRef.current = typeof value === 'function' ? value(keysRef.current) : value; states.push(keysRef.current); },
  };
  const act = createAct(controller.signal, env);
  return { controller, keysRef, act, states };
}

test('key stays down throughout its scene action and releases when it completes', async () => {
  const { controller, keysRef, act } = keyAction();
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const action = act.key('left', async () => {
    started.resolve();
    await finish.promise;
    expect(keysRef.current.down).toBe(true);
  });
  await started.promise;
  expect(keysRef.current.show).toBe(true);
  expect(keysRef.current.down).toBe(true);
  finish.resolve();
  await action;
  expect(keysRef.current.down).toBe(false);
  controller.abort();
});

test('interrupting a held scene action cancels its pending work', async () => {
  const { controller, act } = keyAction();
  const started = Promise.withResolvers<void>();
  let continued = false;
  const action = act.key('left', async () => {
    started.resolve();
    await act.wait(10000);
    continued = true;
  });
  await started.promise;
  controller.abort();
  await expect(action).rejects.toBeInstanceOf(Stopped);
  expect(continued).toBe(false);
});


test('consecutive presses reuse the visible keycap without another fade', async () => {
  const { controller, keysRef, act, states } = keyAction();
  await act.key('alt+left');
  const firstId = keysRef.current.id;
  states.length = 0;
  await act.key('alt+left');
  expect(states.map(({ id }) => id)).toEqual([firstId, firstId]);
  expect(states.every(({ show }) => show)).toBe(true);
  expect(states.map(({ down }) => down)).toEqual([true, false]);
  controller.abort();
});
