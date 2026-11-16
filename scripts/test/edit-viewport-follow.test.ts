import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { followEditViewport } from '../../src/lib/editViewportFollow';

function fixture(attribute = 'data-crop-viewport', visible = true) {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<div class="dev-segmented">${['desktop', 'tablet', 'mobile'].map((preset) =>
    `<button ${attribute}="${preset}">${preset}</button>`,
  ).join('')}</div>`;
  const group = document.querySelector<HTMLElement>('.dev-segmented')!;
  group.getClientRects = () => (visible ? [{}] : []) as unknown as DOMRectList;
  const frames: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  const scope = {
    listen(target: EventTarget, type: string, callback: EventListener) {
      target.addEventListener(type, callback);
      cleanups.push(() => target.removeEventListener(type, callback));
    },
    frame(callback: () => void) { frames.push(callback); },
  };
  const mount = new Function('window', 'document', `return (${followEditViewport.toString()});`)(window, document);
  mount(scope);
  const clicks: string[] = [];
  const details: number[] = [];
  group.addEventListener('click', (event) => details.push(event.detail));
  group.addEventListener('click', (event) => clicks.push((event.target as HTMLButtonElement).textContent!));
  const change = (preset: string) => window.dispatchEvent(new window.CustomEvent('vcd:edit-viewport-change', { detail: { preset } }));
  const step = () => frames.splice(0).forEach((callback) => callback());
  return { window, group, clicks, details, change, step, dispose: async () => {
    cleanups.forEach((cleanup) => cleanup());
    await window.happyDOM.abort();
  } };
}

test('visible selectors follow Mobile, Tablet and Desktop through their own clicks', async () => {
  const f = fixture('data-reddit-board-viewport');
  try {
    f.change('mobile'); f.change('tablet'); f.change('desktop');
    expect(f.clicks).toEqual(['mobile', 'tablet', 'desktop']);
    expect(f.details).toEqual([1, 1, 1]);
  } finally { await f.dispose(); }
});

test('hidden selectors and preview preset groups are ignored', async () => {
  for (const f of [fixture('data-grid-viewport', false), fixture('data-viewport-preset')]) {
    try {
      f.change('mobile');
      expect(f.clicks).toEqual([]);
    } finally { await f.dispose(); }
  }
});

test('class and aria active segments are not clicked again', async () => {
  const f = fixture();
  try {
    f.group.querySelector('[data-crop-viewport="mobile"]')!.classList.add('is-active');
    f.group.querySelector('[data-crop-viewport="tablet"]')!.setAttribute('aria-pressed', 'true');
    f.change('mobile'); f.change('tablet');
    expect(f.clicks).toEqual([]);
  } finally { await f.dispose(); }
});

test('a panel opened later follows the current preset after two animation frames', async () => {
  const f = fixture('data-caption-viewport', false);
  try {
    f.change('mobile');
    f.group.getClientRects = () => [{}] as unknown as DOMRectList;
    f.window.dispatchEvent(new f.window.CustomEvent('vcd:dev-edit-open'));
    f.step();
    expect(f.clicks).toEqual([]);
    f.step();
    expect(f.clicks).toEqual(['mobile']);
  } finally { await f.dispose(); }
});

test('choosing a viewport in a panel requests that preview once; following the preview requests nothing', async () => {
  const f = fixture();
  try {
    f.window.document.documentElement.classList.add('is-dev-mode');
    const requests: string[] = [];
    f.window.addEventListener('vcd:edit-viewport-request', (event) => requests.push((event as unknown as CustomEvent).detail.preset));
    f.group.querySelector<HTMLButtonElement>('[data-crop-viewport="mobile"]')!.click();
    expect(requests).toEqual(['mobile']);
    f.change('tablet');
    expect(f.clicks).toEqual(['mobile', 'tablet']);
    expect(f.details).toEqual([0, 1]);
    expect(requests).toEqual(['mobile']);
  } finally { await f.dispose(); }
});

test('a hoisted selector receives a detail-one click from its own realm', async () => {
  const f = fixture();
  const shell = new Window();
  try {
    shell.document.body.append(f.group);
    const queryAll = f.window.document.querySelectorAll.bind(f.window.document);
    f.window.document.querySelectorAll = ((selector: string) => selector === '.dev-segmented'
      ? shell.document.querySelectorAll(selector) : queryAll(selector)) as typeof queryAll;
    let click: MouseEvent | undefined;
    shell.document.addEventListener('click', (event) => { click = event as unknown as MouseEvent; }, true);
    f.change('mobile');
    expect(f.details).toEqual([1]);
    expect(click).toBeInstanceOf(shell.MouseEvent);
    expect(click!.bubbles).toBe(true);
    expect(click!.cancelable).toBe(true);
  } finally {
    await f.dispose();
    await shell.happyDOM.abort();
  }
});

test('at the Desktop preset a panel follows the layout the window width gives', async () => {
  const f = fixture();
  try {
    const width = (value: number) => Object.defineProperty(f.window, 'innerWidth', { configurable: true, value });
    width(900);
    f.window.dispatchEvent(new f.window.Event('vcd:dev-edit-open'));
    f.step(); f.step();
    expect(f.clicks).toEqual(['tablet']);
    width(600);
    f.window.dispatchEvent(new f.window.Event('resize'));
    width(1400);
    f.window.dispatchEvent(new f.window.Event('resize'));
    expect(f.clicks).toEqual(['tablet', 'mobile', 'desktop']);
    width(600);
    f.change('tablet');
    expect(f.clicks).toEqual(['tablet', 'mobile', 'desktop', 'tablet']);
  } finally { await f.dispose(); }
});
