import { describe, expect, test } from 'bun:test';
import { createHistory } from '../../src/lib/devHistory';

describe('editor history', () => {
  test('undo and redo span action types and survive a save boundary', async () => {
    const history = createHistory();
    let text = '', crop = 1;
    text = 'Hello';
    history.push({ label: 'Text', undo: () => { text = ''; }, redo: () => { text = 'Hello'; } });
    crop = 2;
    history.push({ label: 'Crop', undo: () => { crop = 1; }, redo: () => { crop = 2; } });
    history.breakGroup();
    await history.undo();
    expect([text, crop]).toEqual(['Hello', 1]);
    await history.undo();
    expect(text).toBe('');
    await history.redo();
    await history.redo();
    expect([text, crop]).toEqual(['Hello', 2]);
  });
  test('typing coalesces, a different action breaks grouping, and edits invalidate redo', async () => {
    const history = createHistory();
    let value = 2;
    history.push({ label: 'Text', mergeKey: 'title', undo: () => { value = 0; }, redo: () => { value = 1; } });
    history.push({ label: 'Text', mergeKey: 'title', undo: () => { value = 1; }, redo: () => { value = 2; } });
    await history.undo();
    expect(value).toBe(0);
    await history.redo();
    expect(value).toBe(2);
    await history.undo();
    history.push({ label: 'Replacement', undo() {}, redo() {} });
    expect(history.canRedo).toBe(false);
  });
  test('an exhausted panel cannot consume an earlier page action', async () => {
    const history = createHistory();
    let value = 1;
    history.push({ label: 'Page', undo: () => { value = 0; }, redo: () => { value = 1; } });
    const scope = history.scope();
    await scope.undo();
    expect(value).toBe(1);
    value = 2;
    history.push({ label: 'Panel', undo: () => { value = 1; }, redo: () => { value = 2; } });
    await scope.undo();
    await scope.undo();
    expect(value).toBe(1);
    await scope.redo();
    expect(value).toBe(2);
  });
  test('failed asynchronous undo preserves the command and blocks concurrent replay', async () => {
    const history = createHistory();
    let fail = true, calls = 0;
    history.push({ label: 'Persisted edit', async undo() {
      calls += 1;
      await Promise.resolve();
      if (fail) throw new Error('Offline');
    }, redo() {} });
    const first = history.undo();
    await history.undo();
    await expect(first).rejects.toThrow('Offline');
    expect(calls).toBe(1);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    fail = false;
    await history.undo();
    expect(history.canRedo).toBe(true);
  });
  test('replaying cannot recursively record another action', async () => {
    const history = createHistory();
    history.push({ label: 'Edit', undo() { history.push({ label: 'Recursive', undo() {}, redo() {} }); }, redo() {} });
    await history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });
});
