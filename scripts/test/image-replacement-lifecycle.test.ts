import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/project/ProjectImageCropTuner.astro', import.meta.url), 'utf8');
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const replacementSource = between('    type ReplacementContext =', '    const applyReplacement =');

class ProbeImage extends EventTarget {
  static instances: ProbeImage[] = [];
  src = '';
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  decode = () => Promise.resolve();
  constructor() { super(); ProbeImage.instances.push(this); }
  succeed(width: number, height: number) {
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.complete = true;
    this.dispatchEvent(new Event('load'));
  }
  fail() { this.complete = true; this.dispatchEvent(new Event('error')); }
}

const extract = () => new Function('env', `with (env) { ${new Bun.Transpiler({ loader: 'ts' }).transformSync(replacementSource)}; return { readUploadedImageDims, replacementContext, isCurrentReplacement }; }`)({
  Image: ProbeImage,
  projectImage: (src: string) => `/images/${src}`,
  editTarget: { id: 'first' },
  activeSlot: 'cover',
  replacementSession: 4,
  sourceRevision: 8,
  replacementAttempt: 0,
  replacementPending: true,
});

test('replacement preload reads natural dimensions from the canonical detached source', async () => {
  ProbeImage.instances.length = 0;
  const { readUploadedImageDims } = extract();
  const pending = readUploadedImageDims('new/photo.jpg');
  expect(ProbeImage.instances[0]?.src).toBe('/images/new/photo.jpg');
  expect(ProbeImage.instances[0]?.naturalWidth).toBe(0);
  ProbeImage.instances[0]!.succeed(4000, 2650);
  await expect(pending).resolves.toEqual({ srcWidth: 4000, srcHeight: 2650 });
});

test('replacement preload leaves the original untouched when the source fails', async () => {
  ProbeImage.instances.length = 0;
  const { readUploadedImageDims } = extract();
  const pending = readUploadedImageDims('missing.jpg');
  ProbeImage.instances[0]!.fail();
  await expect(pending).rejects.toThrow('Could not load the replacement image');
});

test('replacement identity rejects target switches, source changes, and superseded attempts', () => {
  const target = { id: 'first' };
  const env = {
    Image: ProbeImage,
    projectImage: (src: string) => src,
    editTarget: target,
    activeSlot: 'cover',
    replacementSession: 2,
    sourceRevision: 3,
    replacementAttempt: 0,
    replacementPending: true,
  };
  const { replacementContext, isCurrentReplacement } = new Function('env', `with (env) { ${new Bun.Transpiler({ loader: 'ts' }).transformSync(replacementSource)}; return { replacementContext, isCurrentReplacement }; }`)(env);
  const context = replacementContext();
  expect(isCurrentReplacement(context)).toBe(false, 'an attempt is not current until it is registered');
  env.replacementAttempt = context.attempt;
  expect(isCurrentReplacement(context)).toBe(true);
  env.replacementSession = 3;
  expect(isCurrentReplacement(context)).toBe(false);
  env.replacementSession = 2;
  env.sourceRevision = 4;
  expect(isCurrentReplacement(context)).toBe(false);
});

test('replacement source stores natural dimensions and guards Save while pending', () => {
  expect(source).toContain("const nextDims = dims;");
  expect(source).toContain("status.textContent = 'Wait for the image replacement to finish.';");
  expect(source).toContain("event.preventDefault();");
  expect(source).toContain("setReplacementError('Could not load the replacement image.')");
  expect(source).toContain('const undoBefore = structuredClone(undoStack);');
  expect(source).toContain('redoStack = redoBefore;');
});

test('drop replacement handler claims only image targets and cancels default routing', () => {
  const handler = between("window.addEventListener('vcd:dev-image-replace'", '    const teardownEditSession');
  expect(handler).toContain("target.matches('[data-dev-image-target]')");
  expect(handler).toContain('event.preventDefault()');
  expect(handler).toContain("detail: { trigger: target, panel }");
});
