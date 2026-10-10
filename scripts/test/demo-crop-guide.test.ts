import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDemoCropGuide } from '../../src/lib/demoCropGuide';

type Harness = ReturnType<typeof setup>;

function setup(reduced = false, frameStep = 16, coarse = false) {
  const win = new Window({ url: 'http://localhost/' });
  let now = 0; let next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, FrameRequestCallback>();
  Object.defineProperty(win, 'performance', { value: { now: () => now }, configurable: true });
  win.setTimeout = ((callback: TimerHandler, delay?: number) => { const id = ++next; timers.set(id, { at: now + Number(delay || 0), callback: callback as () => void }); return id; }) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof win.clearTimeout;
  win.requestAnimationFrame = ((callback: FrameRequestCallback) => { const id = ++next; frames.set(id, callback); return id; }) as typeof win.requestAnimationFrame;
  win.cancelAnimationFrame = ((id: number) => { frames.delete(id); }) as typeof win.cancelAnimationFrame;
  win.matchMedia = ((query: string) => ({ matches: query.includes('prefers-reduced-motion') ? reduced : query.includes('pointer: coarse') ? coarse : false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as typeof win.matchMedia;
  const root = win.document.createElement('div');
  const host = win.document.createElement('div');
  const trigger = win.document.createElement('button');
  const fingers: [HTMLElement, HTMLElement] = [win.document.createElement('span'), win.document.createElement('span')];
  root.append(host, trigger); win.document.body.append(root);
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  host.getBoundingClientRect = () => rect(100, 100, 400, 300);
  trigger.getBoundingClientRect = () => rect(400, 110, 80, 30);
  const pans: Array<[number, number]> = [];
  const zooms: Array<number> = [];
  let finish = 0;
  const crop = { panBy: (x: number, y: number) => { pans.push([x, y]); return true; }, zoomBy: (factor: number) => { zooms.push(factor); return true; } };
  const guide = createDemoCropGuide({ root, host, trigger, fingers, crop, onFinish: () => { finish += 1; } });
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  const advance = async (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(now); }
    await flush();
  };
  const advanceTo = async (ms: number) => { for (let elapsed = 0; elapsed < ms; elapsed += frameStep) await advance(frameStep); };
  return { win, root, fingers, guide, pans, zooms, get finish() { return finish; }, flush, advance, advanceTo, pending: () => ({ frames: frames.size, timers: timers.size }), overlay: () => root.ownerDocument.querySelector('.demo-crop-guide') as HTMLElement | null };
}

const fingerPoint = (finger: HTMLElement) => {
  const match = finger.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
};

async function playThrough(h: Harness) {
  h.guide.play(); await h.flush(); await h.advanceTo(7000);
}

for (const frameStep of [16, 33]) {
  test(`completes the crop gesture at ${frameStep}ms frames with exact pan and zoom totals`, async () => {
    const h = setup(false, frameStep);
    await playThrough(h);
    expect(h.finish).toBe(1);
    expect(h.overlay()?.hidden).toBe(true);
    expect(h.pans.reduce((sum, [x]) => sum + x, 0)).toBeCloseTo(0.08, 5);
    expect(h.pans.reduce((sum, [, y]) => sum + y, 0)).toBeCloseTo(0.045, 5);
    expect(h.zooms.reduce((product, factor) => product * factor, 1)).toBeCloseTo(1.12, 5);
    h.guide.destroy();
  });
}

test('fine pointers use two visible fingers for pan and preserve the gesture spacing', async () => {
  const h = setup(false, 16, false); h.guide.play(); await h.flush();
  for (let i = 0; i < 400 && h.pans.length === 0; i += 1) await h.advance(16);
  const first = h.fingers.map(fingerPoint);
  expect(h.fingers[0].style.opacity).toBe('1');
  expect(h.fingers[1].style.opacity).toBe('1');
  await h.advance(16);
  const second = h.fingers.map(fingerPoint);
  expect(second[0].x - first[0].x).toBeCloseTo(second[1].x - first[1].x, 5);
  expect(second[0].y - first[0].y).toBeCloseTo(second[1].y - first[1].y, 5);
  expect(Math.abs(first[0].x - first[1].x)).toBeCloseTo(40, 0);
  expect(Math.abs(first[0].y - first[1].y)).toBeCloseTo(12, 0);
  await h.advanceTo(7000); h.guide.destroy();
});

test('coarse pointers keep the second finger hidden during pan', async () => {
  const h = setup(false, 16, true); h.guide.play(); await h.flush();
  for (let i = 0; i < 400 && h.pans.length === 0; i += 1) await h.advance(16);
  expect(h.fingers[0].style.opacity).toBe('1');
  expect(Number(h.fingers[1].style.opacity || '0')).toBe(0);
  await h.advanceTo(7000); h.guide.destroy();
});

for (const coarse of [false, true]) {
  test(`fine=${!coarse} and coarse=${coarse} pinch starts at the full finger separation`, async () => {
    const h = setup(false, 16, coarse); h.guide.play(); await h.flush();
    for (let i = 0; i < 700 && h.zooms.length === 0; i += 1) await h.advance(16);
    const first = h.fingers.map(fingerPoint);
    const separation = Math.abs(first[0].x - first[1].x);
    expect(separation).toBeGreaterThanOrEqual(110);
    expect(separation).toBeLessThanOrEqual(114);
    await h.advanceTo(7000);
    expect(h.zooms.reduce((product, factor) => product * factor, 1)).toBeCloseTo(1.12, 5);
    h.guide.destroy();
  });
}

test('stopping during pan freezes the gesture and prevents finish', async () => {
  const h = setup(); h.guide.play(); await h.flush();
  for (let i = 0; i < 400 && h.pans.length === 0; i += 1) await h.advance(16);
  const panCount = h.pans.length;
  h.guide.stop(); await h.advanceTo(10000);
  expect(panCount).toBeGreaterThan(0);
  expect(h.pans).toHaveLength(panCount);
  expect(h.zooms).toHaveLength(0);
  expect(h.finish).toBe(0);
  h.guide.destroy();
});

test('repeat play then destroy clears pending motion and overlay', async () => {
  const h = setup(); h.guide.play(); await h.flush(); await h.advanceTo(500); h.guide.play(); await h.flush(); await h.advanceTo(250); h.guide.destroy(); await h.advanceTo(10000);
  expect(h.pending()).toEqual({ frames: 0, timers: 0 });
  expect(h.overlay()).toBeNull();
  expect(h.finish).toBe(0);
});

test('reduced motion skips crop edits and finish', async () => {
  const h = setup(true); h.guide.play(); await h.flush(); await h.advanceTo(7000);
  expect(h.pans).toHaveLength(0); expect(h.zooms).toHaveLength(0); expect(h.finish).toBe(0); h.guide.destroy();
});

test('scroll cancellation stops the guide before it edits the crop', async () => {
  const h = setup(); h.guide.play(); await h.flush(); await h.advanceTo(300);
  h.win.document.dispatchEvent(new h.win.Event('scroll')); await h.advanceTo(7000);
  expect(h.pans).toHaveLength(0); expect(h.zooms).toHaveLength(0); expect(h.finish).toBe(0); h.guide.destroy();
});
