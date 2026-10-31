import { afterEach, afterAll, describe, expect, test } from 'bun:test';
import { createHomeIntroController } from '../../src/scripts/homeIntro';

class FixtureElement {
  dataset: Record<string, string> = {};
  style: Record<string, string> = { overflow: '' };
  hidden = false;
  inert = false;
  focused = false;
  tag = 'div';
  listeners = new Map<string, Set<EventListener>>();
  children: Record<string, FixtureElement> = {};
  attrs = new Map<string, string>();
  classList = { contains: (_name: string) => false };
  addEventListener(name: string, fn: EventListener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: EventListener) { this.listeners.get(name)?.delete(fn); }
  emit(type: string, detail: Record<string, unknown> = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...detail,
    } as unknown as Event;
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  querySelector<T extends FixtureElement>(selector: string) { return this.children[selector] as T | undefined; }
  querySelectorAll() { return []; }
  closest() { return this.tag === 'a' || this.tag === 'button' ? this : null; }
  contains(node: unknown): boolean { return node === this || Object.values(this.children).some((child) => child.contains(node)); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string) { return this.attrs.has(name); }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  focus() { this.focused = true; fixtureDocument.activeElement = this; }
  matches() { return true; }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}

const fixtureDocument = {
  body: { style: { overflow: '' } },
  activeElement: null as FixtureElement | null,
  getElementById: (id: string) => id === 'main-content' ? fixtureDocument.main : null,
  main: new FixtureElement(),
};

const originalGlobals = Object.fromEntries(['Element', 'HTMLElement', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, {
  Element: FixtureElement,
  HTMLElement: FixtureElement,
  document: fixtureDocument,
});

const fixtureWindow = (storage?: Storage) => {
  const listeners = new Map<string, Set<EventListener>>();
  const defaultStorage = new Map<string, string>();
  const sessionStorage = storage ?? {
    getItem: (key: string) => defaultStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { defaultStorage.set(key, value); },
  };
  return {
    addEventListener(name: string, fn: EventListener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    },
    removeEventListener(name: string, fn: EventListener) { listeners.get(name)?.delete(fn); },
    dispatchEvent(event: Event) { for (const fn of listeners.get(event.type) ?? []) fn(event); return true; },
    emit(type: string, detail: Record<string, unknown> = {}) {
      const event = { type, ...detail } as unknown as Event;
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    scrollTo() {},
    getSelection: () => ({ isCollapsed: true }),
    matchMedia: () => ({ matches: false }),
    sessionStorage,
  } as unknown as Window & { emit: (type: string, detail?: Record<string, unknown>) => void };
};

const controllers: Array<ReturnType<typeof createHomeIntroController>> = [];
afterEach(() => controllers.splice(0).forEach((controller) => controller.teardown()));
afterAll(() => {
  Object.entries(originalGlobals).forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});
const fixture = (storage?: Storage, introDocument?: string) => {
  fixtureDocument.activeElement = null;
  fixtureDocument.main = new FixtureElement();
  fixtureDocument.body.style.overflow = '';
  const surface = new FixtureElement();
  const okay = new FixtureElement();
  okay.tag = 'button';
  const cursor = new FixtureElement();
  surface.children['[data-home-intro-okay="true"]'] = okay;
  surface.children['[data-home-intro-cursor]'] = cursor;
  const home = new FixtureElement();
  if (introDocument) home.dataset.introDocument = introDocument;
  const root = new FixtureElement();
  const win = fixtureWindow(storage);
  const controller = createHomeIntroController(surface, home, root, win);
  controllers.push(controller);
  return { surface, okay, cursor, home, root, win, controller };
};

const waitForExit = () => new Promise((resolve) => setTimeout(resolve, 270));
const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('home intro controller', () => {
  test('waits without activation and ignores links and selected text', async () => {
    const f = fixture();
    await waitForExit();
    expect(f.controller.getState()).toBe('active');
    expect(f.home.inert).toBe(true);
    const link = new FixtureElement();
    link.tag = 'a';
    f.surface.emit('click', { target: link });
    f.win.getSelection = () => ({ isCollapsed: false });
    f.surface.emit('click');
    expect(f.controller.getState()).toBe('active');
  });

  test('Okay dismisses once and focuses main content', async () => {
    const f = fixture();
    let completed = 0;
    const startingStates: string[] = [];
    f.win.addEventListener('vcd:home-intro-dismissing', () => startingStates.push(f.controller.getState()));
    f.win.addEventListener('vcd:home-intro-dismissed', () => completed++);
    f.okay.focus();
    f.okay.emit('click');
    f.okay.emit('click');
    expect(startingStates).toEqual(['dismissing']);
    expect(completed).toBe(0);
    await waitForExit();
    expect(f.controller.getState()).toBe('dismissed');
    expect(completed).toBe(1);
    expect(fixtureDocument.activeElement).toBe(fixtureDocument.main);
    expect(f.surface.hidden).toBe(true);
    expect(f.surface.inert).toBe(true);
    expect(f.home.inert).toBe(false);
  });

  test('same-tab replacement skips the intro while a fresh tab shows it', () => {
    const first = fixture();
    first.controller.teardown();
    const replacement = createHomeIntroController(first.surface, first.home, first.root, first.win);
    controllers.push(replacement);
    expect(replacement.getState()).toBe('dismissed');
    expect(fixture().controller.getState()).toBe('active');
  });

  test('digital uses the shared seen marker and restores its page surface', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    } as unknown as Storage;
    const digital = fixture(storage, 'play');
    const surfaces: string[] = [];
    digital.win.addEventListener('vcd:page-surface-change', ((event: CustomEvent<{ documentKey?: string }>) => {
      if (event.detail?.documentKey) surfaces.push(event.detail.documentKey);
    }) as EventListener);
    expect(digital.controller.getState()).toBe('active');
    digital.controller.dismiss();
    await waitForExit();
    expect(surfaces).toContain('play');

    const home = fixture(storage);
    expect(home.controller.getState()).toBe('dismissed');
  });

  test('pointerdown alone never dismisses; the later click starts the exit', async () => {
    const f = fixture();
    let completed = 0;
    f.win.addEventListener('vcd:home-intro-dismissed', () => completed++);
    f.okay.emit('pointerdown', { button: 0 });
    await waitFor(180);
    expect(f.controller.getState()).toBe('active');
    expect(f.home.inert).toBe(true);
    const click = f.okay.emit('click') as unknown as MouseEvent;
    expect(click.defaultPrevented).toBe(true);
    expect(f.home.inert).toBe(true);
    expect(f.controller.getState()).toBe('dismissing');
    expect(f.home.inert).toBe(true);
    await waitFor(90);
    expect(f.controller.getState()).toBe('dismissing');
    expect(completed).toBe(0);
    await waitFor(90);
    expect(f.controller.getState()).toBe('dismissed');
    expect(completed).toBe(1);
  });

  test('late initial pageshow cannot resurrect a dismissed intro', async () => {
    const f = fixture();
    let scroll: ScrollToOptions | undefined;
    f.win.scrollTo = ((options: ScrollToOptions) => { scroll = options; }) as typeof window.scrollTo;
    f.controller.dismiss();
    f.win.emit('pageshow', { persisted: false });
    expect(f.controller.getState()).toBe('dismissing');
    await waitForExit();
    f.win.emit('pageshow', { persisted: false });
    expect(f.controller.getState()).toBe('dismissed');
    expect(scroll).toEqual({ top: 0, left: 0, behavior: 'instant' });
  });

  test('uses an explicit intro duration override', async () => {
    const f = fixture();
    f.controller.teardown();
    const replacement = createHomeIntroController(f.surface, f.home, f.root, f.win, { durationMs: 200 });
    replacement.reset();
    controllers.push(replacement);
    replacement.dismiss();
    await waitFor(130);
    expect(replacement.getState()).toBe('dismissing');
    replacement.teardown();
  });

  test('Edit cancels an in-flight dismissal', async () => {
    const f = fixture();
    f.okay.emit('click');
    f.root.classList = { contains: (name: string) => name === 'is-dev-mode' };
    f.win.emit('vcd:dev-mode-change', { detail: { active: true } });
    await waitForExit();
    expect(f.controller.getState()).toBe('editing');
  });

  test('persisted pageshow keeps the intro dismissed after pagehide during dismissal', async () => {
    const f = fixture();
    f.okay.emit('click');
    f.win.emit('pagehide');
    await waitForExit();
    f.win.emit('pageshow', { persisted: true });
    expect(f.controller.getState()).toBe('dismissed');
    expect(f.home.inert).toBe(false);
    expect(fixtureDocument.body.style.overflow).toBe('');
  });

  test('storage failures preserve first-load behavior without throwing', () => {
    const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } as unknown as Storage;
    const surface = new FixtureElement();
    const home = new FixtureElement();
    const root = new FixtureElement();
    const win = fixtureWindow(storage);
    const controller = createHomeIntroController(surface, home, root, win);
    controllers.push(controller);
    expect(controller.getState()).toBe('active');
  });

  test('reset replays a seen intro without clearing the tab marker', () => {
    const f = fixture();
    f.controller.teardown();
    const replacement = createHomeIntroController(f.surface, f.home, f.root, f.win);
    controllers.push(replacement);
    expect(replacement.getState()).toBe('dismissed');
    replacement.reset();
    expect(replacement.getState()).toBe('active');
    expect(f.win.sessionStorage.getItem('vcd:home-intro-seen')).toBe('true');
  });

  test('empty surface remains active and teardown is repeatable', () => {
    const f = fixture();
    delete f.surface.children['[data-home-intro-okay]'];
    delete f.surface.children['[data-home-intro-cursor]'];
    expect(f.controller.getState()).toBe('active');
    f.controller.teardown();
    f.controller.teardown();
    expect(f.root.style.overflow).toBe('');
    expect(fixtureDocument.body.style.overflow).toBe('');
  });

  test('mouse movement shows the decorative Enter cursor and records mouse mode', () => {
    const f = fixture();
    f.surface.emit('pointermove', { pointerType: 'mouse', clientX: 120, clientY: 80 });
    expect(f.surface.dataset.homeIntroPointer).toBe('mouse');
    expect(f.surface.dataset.homeIntroCursorActive).toBe('true');
    expect(f.cursor.style.display).toBe('block');
    expect(f.cursor.style.transform).toBe('translate(120px, 80px) translate(-50%, -50%)');
  });

  test('touch and pen input hide the cursor and restore the inline action mode', () => {
    const f = fixture();
    f.surface.emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    f.surface.emit('pointermove', { pointerType: 'touch', clientX: 20, clientY: 30 });
    expect(f.surface.dataset.homeIntroPointer).toBe('touch');
    expect(f.surface.dataset.homeIntroCursorActive).toBeUndefined();
    expect(f.cursor.style.display).toBe('none');
    f.surface.emit('pointermove', { pointerType: 'pen', clientX: 20, clientY: 30 });
    expect(f.surface.dataset.homeIntroPointer).toBe('touch');
  });

  test('interactive links keep native cursor behavior while mouse mode remains active', () => {
    const f = fixture();
    const link = new FixtureElement();
    link.tag = 'a';
    f.surface.emit('pointermove', { pointerType: 'mouse', target: link, clientX: 20, clientY: 30 });
    expect(f.surface.dataset.homeIntroPointer).toBe('mouse');
    expect(f.surface.dataset.homeIntroCursorActive).toBeUndefined();
    expect(f.cursor.style.display).toBe('none');
  });

  test('Tab hides the decorative cursor and restores keyboard action mode', () => {
    const f = fixture();
    f.surface.emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    f.win.emit('keydown', { key: 'Tab' });
    expect(f.surface.dataset.homeIntroPointer).toBe('keyboard');
    expect(f.surface.dataset.homeIntroCursorActive).toBeUndefined();
    expect(f.cursor.style.display).toBe('none');
  });

  test('scroll, blur, state changes and teardown hide the cursor', () => {
    const f = fixture();
    f.surface.emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    f.win.emit('scroll');
    expect(f.surface.dataset.homeIntroCursorActive).toBeUndefined();
    f.surface.emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    f.win.emit('blur');
    expect(f.surface.dataset.homeIntroCursorActive).toBeUndefined();
    f.surface.emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    f.win.emit('vcd:dev-mode-change', { detail: { active: true } });
    expect(f.surface.dataset.homeIntroCursorActive).toBeUndefined();
    f.surface.emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    f.controller.teardown();
    expect(f.surface.dataset.homeIntroCursorActive).toBeUndefined();
    f.surface.emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 });
    expect(f.surface.dataset.homeIntroCursorActive).toBeUndefined();
  });
});
