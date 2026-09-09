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
    const event = { type, target: this, defaultPrevented: false, ...detail } as unknown as Event;
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  querySelector<T extends FixtureElement>(selector: string) { return this.children[selector] as T | undefined; }
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

const fixtureWindow = () => {
  const listeners = new Map<string, Set<EventListener>>();
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
    getSelection: () => ({ isCollapsed: true }),
    matchMedia: () => ({ matches: false }),
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
const fixture = () => {
  fixtureDocument.activeElement = null;
  fixtureDocument.main = new FixtureElement();
  fixtureDocument.body.style.overflow = '';
  const surface = new FixtureElement();
  const okay = new FixtureElement();
  okay.tag = 'button';
  const cursor = new FixtureElement();
  surface.children['[data-home-intro-okay]'] = okay;
  surface.children['[data-home-intro-cursor]'] = cursor;
  const home = new FixtureElement();
  const root = new FixtureElement();
  const win = fixtureWindow();
  const controller = createHomeIntroController(surface, home, root, win);
  controllers.push(controller);
  return { surface, okay, home, root, win, controller };
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
    f.win.addEventListener('vcd:home-intro-dismissed', () => completed++);
    f.okay.focus();
    f.okay.emit('click');
    f.okay.emit('click');
    await waitForExit();
    expect(f.controller.getState()).toBe('dismissed');
    expect(completed).toBe(1);
    expect(fixtureDocument.activeElement).toBe(fixtureDocument.main);
    expect(f.surface.hidden).toBe(true);
    expect(f.surface.inert).toBe(true);
    expect(f.home.inert).toBe(false);
  });

  test('primary pointerdown starts the 150ms exit and dispatches once after it settles', async () => {
    const f = fixture();
    let completed = 0;
    f.win.addEventListener('vcd:home-intro-dismissed', () => completed++);
    f.okay.emit('pointerdown', { button: 2 });
    expect(f.controller.getState()).toBe('active');
    f.okay.emit('pointerdown', { button: 0 });
    expect(f.controller.getState()).toBe('dismissing');
    await waitFor(90);
    expect(f.controller.getState()).toBe('dismissing');
    expect(completed).toBe(0);
    await waitFor(90);
    expect(f.controller.getState()).toBe('dismissed');
    expect(completed).toBe(1);
  });

  test('uses an explicit intro duration override', async () => {
    const f = fixture();
    f.controller.teardown();
    const replacement = createHomeIntroController(f.surface, f.home, f.root, f.win, { durationMs: 200 });
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

  test('persisted pageshow restores active after pagehide during dismissal', async () => {
    const f = fixture();
    f.okay.emit('click');
    f.win.emit('pagehide');
    await waitForExit();
    f.win.emit('pageshow', { persisted: true });
    expect(f.controller.getState()).toBe('active');
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
});
