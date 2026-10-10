export function createDemoSaveFeedback(button: HTMLButtonElement | null) {
  const win = button?.ownerDocument.defaultView;
  let savingTimer: ReturnType<Window['setTimeout']> | undefined;
  let savedTimer: ReturnType<Window['setTimeout']> | undefined;
  let destroyed = false;
  const clear = () => {
    if (!win) return;
    if (savingTimer !== undefined) win.clearTimeout(savingTimer);
    if (savedTimer !== undefined) win.clearTimeout(savedTimer);
    savingTimer = savedTimer = undefined;
  };
  const idle = () => {
    if (!button || destroyed) return;
    button.dataset.saveState = 'idle';
    button.setAttribute('aria-busy', 'false');
    button.setAttribute('aria-label', 'Save changes');
  };
  const begin = () => {
    if (!button || !win || destroyed) return;
    clear();
    button.dataset.saveState = 'idle';
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', 'Saving changes');
    savingTimer = win.setTimeout(() => {
      savingTimer = undefined;
      if (!destroyed && button) button.dataset.saveState = 'saving';
    }, 700);
  };
  const succeed = () => {
    if (!button || !win || destroyed) return;
    if (savingTimer !== undefined) win.clearTimeout(savingTimer);
    savingTimer = undefined;
    button.dataset.saveState = 'saved';
    button.setAttribute('aria-busy', 'false');
    button.setAttribute('aria-label', 'Saved');
    if (savedTimer !== undefined) win.clearTimeout(savedTimer);
    savedTimer = win.setTimeout(() => {
      savedTimer = undefined;
      idle();
    }, 1000);
  };
  const reset = () => { clear(); idle(); };
  const destroy = () => { if (destroyed) return; destroyed = true; clear(); };
  idle();
  return { begin, succeed, reset, destroy };
}
