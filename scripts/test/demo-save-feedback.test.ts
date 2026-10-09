import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoSaveFeedback } from '../../src/lib/demoSaveFeedback';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('feedback delays saving state and returns to idle after saved display', async () => {
  const win = new Window();
  const button = win.document.createElement('button');
  const feedback = createDemoSaveFeedback(button);
  expect(button.dataset.saveState).toBe('idle');
  feedback.begin();
  expect(button.dataset.saveState).toBe('idle');
  expect(button.getAttribute('aria-busy')).toBe('true');
  await wait(720);
  expect(button.dataset.saveState).toBe('saving');
  feedback.succeed();
  expect(button.dataset.saveState).toBe('saved');
  expect(button.getAttribute('aria-label')).toBe('Saved');
  await wait(1020);
  expect(button.dataset.saveState).toBe('idle');
  expect(button.getAttribute('aria-label')).toBe('Save changes');
  feedback.destroy();
});

test('reset clears delayed and saved feedback, and destroy prevents stale mutations', async () => {
  const win = new Window();
  const button = win.document.createElement('button');
  const feedback = createDemoSaveFeedback(button);
  feedback.begin();
  feedback.reset();
  await wait(720);
  expect(button.dataset.saveState).toBe('idle');
  feedback.begin();
  feedback.succeed();
  feedback.destroy();
  await wait(1020);
  expect(button.dataset.saveState).toBe('saved');
  expect(button.getAttribute('aria-label')).toBe('Saved');
});
