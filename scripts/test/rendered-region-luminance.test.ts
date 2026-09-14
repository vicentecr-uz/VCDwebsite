import assert from 'node:assert/strict';
import test from 'node:test';

import { measureRenderedRegionLuma } from '../../src/scripts/coverLuminance';

Object.assign(globalThis, { document: { createElement: () => ({}) } });

type RecordingContext = CanvasRenderingContext2D & {
  calls: Array<{ name: string; args: unknown[] }>;
};

function installCanvas(): RecordingContext {
  const calls: RecordingContext['calls'] = [];
  const context = {
    calls,
    fillStyle: '',
    fillRect(...args: unknown[]) { calls.push({ name: 'fillRect', args }); },
    save() { calls.push({ name: 'save', args: [] }); },
    beginPath() { calls.push({ name: 'beginPath', args: [] }); },
    rect(...args: unknown[]) { calls.push({ name: 'rect', args }); },
    clip() { calls.push({ name: 'clip', args: [] }); },
    restore() { calls.push({ name: 'restore', args: [] }); },
    drawImage(...args: unknown[]) { calls.push({ name: 'drawImage', args }); },
    getImageData(...args: unknown[]) {
      calls.push({ name: 'getImageData', args });
      return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
    },
  } as unknown as RecordingContext;
  const testDocument = globalThis.document as unknown as Document;
  const originalCreateElement = testDocument.createElement.bind(testDocument);
  testDocument.createElement = ((name: string) => {
    if (name !== 'canvas') return originalCreateElement(name);
    return { width: 0, height: 0, getContext: () => context } as unknown as HTMLElement;
  }) as typeof testDocument.createElement;
  return context;
}

function call(context: RecordingContext, name: string): unknown[] {
  return context.calls.find((entry) => entry.name === name)?.args ?? [];
}

test('samples the complete requested region, including area outside the frame', () => {
  const context = installCanvas();
  measureRenderedRegionLuma(
    {} as CanvasImageSource,
    { x: -0.25, y: 0.25, w: 0.5, h: 0.5 },
    { width: 100, height: 100 },
    { width: 100, height: 100 },
    null,
    '#abc',
  );

  assert.deepEqual(call(context, 'getImageData'), [0, 0, 64, 64]);
  assert.deepEqual(call(context, 'fillRect'), [0, 0, 64, 64]);
  assert.deepEqual(call(context, 'rect'), [32, -32, 128, 128]);
});

test('fills and samples the complete requested region around every frame edge', () => {
  for (const region of [
    { x: -0.25, y: 0.25, w: 0.5, h: 0.5 },
    { x: 0.25, y: -0.25, w: 0.5, h: 0.5 },
    { x: 0.75, y: 0.25, w: 0.5, h: 0.5 },
    { x: 0.25, y: 0.75, w: 0.5, h: 0.5 },
  ]) {
    const context = installCanvas();
    measureRenderedRegionLuma(
      {} as CanvasImageSource,
      region,
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      null,
      '#abc',
    );
    assert.deepEqual(call(context, 'getImageData'), [0, 0, 64, 64]);
    assert.deepEqual(call(context, 'fillRect'), [0, 0, 64, 64]);
  }
});

test('samples a wholly inside region without clamping it to a larger frame', () => {
  const context = installCanvas();
  measureRenderedRegionLuma(
    {} as CanvasImageSource,
    { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    { width: 100, height: 100 },
    { width: 100, height: 100 },
    null,
    '#abc',
  );
  assert.deepEqual(call(context, 'getImageData'), [0, 0, 64, 64]);
});

test('clips an unlocked crop to the original frame while translating it into the region', () => {
  const context = installCanvas();
  measureRenderedRegionLuma(
    {} as CanvasImageSource,
    { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    { width: 100, height: 100 },
    { width: 100, height: 100 },
    { w: 0.5, cx: 0.5, cy: 0.5 },
    '#abc',
  );

  assert.deepEqual(call(context, 'rect'), [-32, -32, 128, 128]);
  assert.deepEqual(call(context, 'drawImage').slice(1), [
    -96,
    -96,
    256,
    256,
  ]);
  assert.deepEqual(call(context, 'getImageData'), [0, 0, 64, 64]);
});

test('rejects nonpositive or invalid requested regions without creating a canvas', () => {
  const context = installCanvas();
  assert.equal(measureRenderedRegionLuma({} as CanvasImageSource, { x: 0, y: 0, w: 0, h: 1 }, { width: 100, height: 100 }, { width: 100, height: 100 }, null, '#abc'), 0);
  assert.equal(measureRenderedRegionLuma({} as CanvasImageSource, { x: 0, y: 0, w: 1, h: -1 }, { width: 100, height: 100 }, { width: 100, height: 100 }, null, '#abc'), 0);
  assert.equal(measureRenderedRegionLuma({} as CanvasImageSource, { x: 0, y: 0, w: Number.NaN, h: 1 }, { width: 100, height: 100 }, { width: 100, height: 100 }, null, '#abc'), 0);
  assert.equal(context.calls.length, 0);
});
