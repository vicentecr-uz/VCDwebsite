import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createHistory, type HistoryCommand } from '../../src/lib/devHistory';
import { boardViewports, resolveRedditBoardHeights } from '../../src/lib/redditBoardHeight';

const component = readFileSync(new URL('../../src/components/DevRedditBoardHeight.astro', import.meta.url), 'utf8');
const source = component.split('<script>')[1].split('</script>')[0].replace(/^\s*import .*?;\s*$/gm, '');
const lifecycle = readFileSync(new URL('../../src/lib/pageLifecycle.ts', import.meta.url), 'utf8').replaceAll('export function', 'function');
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${lifecycle}\n${source}`);

function setup(initial = { desktop: 20, tablet: null, mobile: 26 }) {
  const win = new Window({ url: 'http://localhost/' });
  const { document } = win;
  document.body.innerHTML = `<div id="main-content">
    <div data-reddit-board-height-panel hidden>
      <input type="range" min="8" max="60" data-reddit-board-height-value data-dev-history-text>
      <button data-reddit-board-reset></button><p data-reddit-board-status></p>
      <button data-reddit-board-viewport="desktop"></button><button data-reddit-board-viewport="tablet"></button><button data-reddit-board-viewport="mobile"></button>
    </div>
    <div data-reddit-comment-board data-reddit-board-document="test" data-dev-content-id="board" data-reddit-board-path='["sections",0]' style="font-size:16px"><div class="reddit-comment-board__shell"></div></div>
  </div>`;
  const board = document.querySelector<HTMLElement>('[data-reddit-board-document]')!;
  board.firstElementChild!.getBoundingClientRect = () => ({ height: 320 }) as DOMRect;
  board.dataset.redditBoardAuthored = JSON.stringify(initial);
  const otherBoard = board.cloneNode(true) as HTMLElement;
  otherBoard.dataset.devContentId = 'other-board';
  otherBoard.dataset.redditBoardPath = '["sections",1]';
  board.after(otherBoard);
  const timers = new Map<number, () => void>();
  let timerId = 0;
  win.setTimeout = ((callback: () => void, delay: number) => {
    expect(delay).toBe(300);
    timers.set(++timerId, callback);
    return timerId;
  }) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof win.clearTimeout;
  const writes: any[] = [];
  const commands: HistoryCommand[] = [];
  const history = createHistory();
  const push = history.push;
  history.push = (command, owner) => { commands.push(command); push(command, owner); };
  const env = {
    window: win, document, Event: win.Event, CustomEvent: win.CustomEvent, Node: win.Node,
    AbortController: win.AbortController, pageHistory: history, breakpoints: boardViewports, resolveRedditBoardHeights,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    fetch: async (_url: string, options: RequestInit) => {
      writes.push(JSON.parse(options.body as string));
      return { ok: true, json: async () => ({}) };
    },
  };
  const dispose = new Function('env', `with (env) { ${code}; return dispose; }`)(env);
  const input = document.querySelector<HTMLInputElement>('input')!;
  const handle = board.querySelector<HTMLButtonElement>('.reddit-board-height-grabber')!;
  handle.setPointerCapture = () => {};
  handle.click();
  const pointer = (target: EventTarget, type: string, clientY = 0) => target.dispatchEvent(new win.PointerEvent(type, { button: 0, pointerId: 1, clientY, bubbles: true }));
  const change = (value: number) => { input.value = String(value); input.dispatchEvent(new win.Event('input')); };
  const slider = (...values: number[]) => {
    pointer(input, 'pointerdown');
    values.forEach(change);
    pointer(document, 'pointerup');
  };
  const flush = async () => {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach((callback) => callback());
    // persist serializes writes and then awaits the response body.
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const close = async () => { dispose(); await win.happyDOM.close(); };
  return { win, document, board, otherBoard, input, handle, history, commands, timers, writes, pointer, change, slider, flush, close };
}

test('one slider drag records one command; undo and redo restore authored heights and save without recording', async () => {
  const h = setup();
  try {
    h.pointer(h.input, 'pointerdown');
    h.change(28);
    h.change(35);
    expect(h.commands).toHaveLength(0);
    h.pointer(h.document, 'pointerup');
    expect(h.commands).toHaveLength(1);
    expect(h.commands[0].label).toBe('Board height');
    await h.flush();
    expect(h.writes.at(-1).changes[0].value).toEqual({ desktop: 35, tablet: null, mobile: 26 });
    await h.history.undo();
    expect(h.input.value).toBe('20');
    expect(h.board.style.getPropertyValue('--rcb-height-tablet')).toBe('20em');
    expect(h.timers.size).toBe(1);
    expect(h.commands).toHaveLength(1);
    expect(h.history.canUndo).toBe(false);
    await h.flush();
    expect(h.writes.at(-1).changes[0].value).toEqual({ desktop: 20, tablet: null, mobile: 26 });
    await h.history.redo();
    expect(h.input.value).toBe('35');
    expect(h.board.style.getPropertyValue('--rcb-height-desktop')).toBe('35em');
    await h.flush();
    expect(h.writes.at(-1).changes[0].value.desktop).toBe(35);
    expect(h.commands).toHaveLength(1);
  } finally { await h.close(); }
});

test('unchanged gestures record nothing and separate slider drags remain separate', async () => {
  const h = setup();
  try {
    h.slider(20);
    h.slider(25, 20);
    expect(h.commands).toHaveLength(0);
    h.slider(25);
    h.slider(30);
    await h.history.undo();
    expect(h.input.value).toBe('25');
    await h.history.undo();
    expect(h.input.value).toBe('20');
  } finally { await h.close(); }
});

test('keyboard steps merge for a board and viewport; Reset is its own reversible command', async () => {
  const h = setup();
  try {
    expect(component).toContain('data-reddit-board-height-value data-dev-history-text');
    h.change(21);
    h.change(22);
    expect(h.commands[0].mergeKey).toBe(h.commands[1].mergeKey);
    h.document.querySelector<HTMLButtonElement>('[data-reddit-board-reset]')!.click();
    await h.history.undo();
    expect(h.input.value).toBe('22');
    await h.history.undo();
    expect(h.input.value).toBe('20');
    expect(h.history.canUndo).toBe(false);
    await h.history.redo();
    expect(h.input.value).toBe('22');
    await h.history.redo();
    await h.flush();
    expect(h.writes.at(-1).changes[0].value.desktop).toBeNull();
  } finally { await h.close(); }
});

test('grabber drag records once and cancelled drag records nothing', async () => {
  const h = setup();
  try {
    h.pointer(h.handle, 'pointerdown');
    h.pointer(h.handle, 'pointermove', 80);
    h.pointer(h.handle, 'pointerup', 80);
    expect(h.commands).toHaveLength(1);
    expect(h.input.value).toBe('25');
    await h.history.undo();
    expect(h.input.value).toBe('20');
    h.pointer(h.handle, 'pointerdown');
    h.pointer(h.handle, 'pointermove', 160);
    h.pointer(h.handle, 'pointercancel', 160);
    expect(h.commands).toHaveLength(1);
    expect(h.input.value).toBe('20');
  } finally { await h.close(); }
});

test('keyboard merging stays within one board and viewport; inactive-board replay preserves the current panel', async () => {
  const h = setup();
  try {
    h.change(21);
    h.change(22);
    h.document.querySelector<HTMLButtonElement>('[data-reddit-board-viewport="tablet"]')!.click();
    h.change(33);
    expect(h.commands[2].mergeKey).not.toBe(h.commands[1].mergeKey);
    h.otherBoard.querySelector<HTMLButtonElement>('.reddit-board-height-grabber')!.click();
    h.change(40);
    await h.history.undo();
    expect(h.input.value).toBe('20');
    await h.history.undo();
    expect(h.board.style.getPropertyValue('--rcb-height-tablet')).toBe('22em');
    expect(h.input.value).toBe('20');
    await h.history.undo();
    expect(h.board.style.getPropertyValue('--rcb-height-desktop')).toBe('20em');
    expect(h.history.canUndo).toBe(false);
    await h.flush();
    expect(JSON.parse(h.board.dataset.redditBoardAuthored!)).toEqual({ desktop: 20, tablet: null, mobile: 26 });
  } finally { await h.close(); }
});

test('undo resolves a replaced inactive board, applies CSS and saves the restored authored object', async () => {
  const h = setup();
  try {
    h.slider(35);
    await h.flush();
    const replacement = h.board.cloneNode(true) as HTMLElement;
    replacement.querySelector('button')?.remove();
    h.board.replaceWith(replacement);
    await h.history.undo();
    expect(replacement.style.getPropertyValue('--rcb-height-desktop')).toBe('20em');
    expect(replacement.style.getPropertyValue('--rcb-height-tablet')).toBe('20em');
    expect(h.timers.size).toBe(1);
    await h.flush();
    expect(JSON.parse(replacement.dataset.redditBoardAuthored!)).toEqual({ desktop: 20, tablet: null, mobile: 26 });
    await h.history.redo();
    expect(replacement.style.getPropertyValue('--rcb-height-desktop')).toBe('35em');
    await h.flush();
    expect(h.writes.at(-1).changes[0].value.desktop).toBe(35);
  } finally { await h.close(); }
});
