import { describe, expect, test } from "bun:test";
import { readFileSync } from 'node:fs';
import { validateSiteAnnotations, type SiteAnnotation } from "../../src/lib/siteAnnotations";
import { siteAnnotationHasFreeInk, siteAnnotationSvg } from "../../src/lib/siteAnnotationSvg";

const sectionIds = new Set(["intro"]);
const valid: SiteAnnotation = {
  id: "highlight-1",
  sectionId: "intro",
  kind: "highlight",
  anchor: { paragraphIndex: 0, exact: "word", prefix: "a ", suffix: " here" },
  board: { w: 240, h: 80 },
  box: { x: 0, y: 0, w: 1, h: 1 },
  strokes: [
    {
      id: 0,
      pen: "highlighter",
      color: "#ffdd00aa",
      size: 18,
      opacity: 0.7,
      points: [
        [0, 30, 0.5],
        [120, 30, 0.6],
      ],
    },
  ],
  mobile: "show",
};

describe("site annotation validation", () => {
  test("accepts a valid anchored annotation", () => {
    expect(validateSiteAnnotations([valid], sectionIds)).toBe(true);
  });

  test("accepts a doodle with negative section-relative offsets", () => {
    expect(
      validateSiteAnnotations(
        [{ ...valid, id: "doodle-1", kind: "doodle", anchor: undefined, box: { x: -80, y: 12, w: 160, h: 90 }, mobile: "hide" }],
        sectionIds,
      ),
    ).toBe(true);
  });

  test("rejects missing anchors, unknown sections, and duplicate ids", () => {
    expect(validateSiteAnnotations([{ ...valid, anchor: undefined }], sectionIds)).toBe(false);
    expect(validateSiteAnnotations([{ ...valid, sectionId: "missing" }], sectionIds)).toBe(false);
    expect(validateSiteAnnotations([valid, valid], sectionIds)).toBe(false);
  });

  test("accepts media anchors and rejects incompatible or malformed targets", () => {
    const doodle = { ...valid, kind: "doodle", anchor: undefined, blockAnchor: { surface: "media", itemPath: ["image-2"] } };
    expect(validateSiteAnnotations([doodle], sectionIds)).toBe(true);
    expect(validateSiteAnnotations([{ ...doodle, anchor: valid.anchor }], sectionIds)).toBe(false);
    expect(validateSiteAnnotations([{ ...doodle, blockAnchor: { surface: "unknown" } }], sectionIds)).toBe(false);
    expect(validateSiteAnnotations([{ ...doodle, blockAnchor: { surface: "block", itemPath: ["image-2"] } }], sectionIds)).toBe(false);
  });

  test("rejects unsafe or non-finite drawing data", () => {
    expect(validateSiteAnnotations([{ ...valid, box: { ...valid.box, w: 0 } }], sectionIds)).toBe(false);
    expect(
      validateSiteAnnotations(
        [{ ...valid, strokes: [{ ...valid.strokes[0], color: "url(https://example.com/x)" }] }],
        sectionIds,
      ),
    ).toBe(false);
    expect(
      validateSiteAnnotations(
        [{ ...valid, strokes: [{ ...valid.strokes[0], points: [[Number.NaN, 0, 0]] }] }],
        sectionIds,
      ),
    ).toBe(false);
  });

  test("rejects payloads above the collection ceilings", () => {
    const many = Array.from({ length: 81 }, (_, index) => ({ ...valid, id: `a-${index}` }));
    expect(validateSiteAnnotations(many, sectionIds)).toBe(false);
    const tooManyPoints = {
      ...valid,
      strokes: [{ ...valid.strokes[0], points: Array.from({ length: 10_001 }, () => [0, 0, 0] as [number, number, number]) }],
    };
    expect(validateSiteAnnotations([tooManyPoints], sectionIds)).toBe(false);
  });

  test("validates contextual text parts and rejects forged references or UTF-16 splits", () => {
    const textParts = [{
      strokeId: 0,
      anchor: { paragraphIndex: 0, exact: "café😀", prefix: "", suffix: "" },
      slices: [{
        start: 0,
        end: 4,
        glyph: { x: 2, y: 3, w: 30, h: 12 },
        clip: { x: 0, y: 0, w: 40, h: 20 },
      }],
    }];
    const annotation = {
      ...valid,
      textParts,
      strokes: [{ ...valid.strokes[0], points: [[0, 30, 0.5], [120, 30, 0.6]] as [number, number, number][] }],
    };
    expect(validateSiteAnnotations([annotation], sectionIds)).toBe(true);
    expect(validateSiteAnnotations([{ ...annotation, textParts: [{ ...textParts[0], strokeId: 99 }] }], sectionIds)).toBe(false);
    expect(validateSiteAnnotations([{ ...annotation, textParts: [{ ...textParts[0], slices: [{ ...textParts[0].slices[0], start: 5, end: 6 }] }] }], sectionIds)).toBe(false);
    expect(validateSiteAnnotations([{ ...annotation, blockAnchor: { surface: "block" } }], sectionIds)).toBe(false);
  });

  test("renders text parts from their mapped stroke while retaining later erasers", () => {
    const annotation: SiteAnnotation = {
      ...valid,
      textParts: [{
        strokeId: 0,
        anchor: valid.anchor!,
        slices: [{ start: 0, end: 4, glyph: { x: 4, y: 5, w: 40, h: 14 }, clip: { x: 0, y: 0, w: 50, h: 20 } }],
      }],
      strokes: [
        valid.strokes[0],
        { ...valid.strokes[0], id: 1, pen: "pen", color: "#111", erase: false },
        { ...valid.strokes[0], id: 2, erase: true },
        { ...valid.strokes[0], id: 3, pen: "pen", color: "#222", erase: false },
      ],
    };
    const part = siteAnnotationSvg(annotation, { partIndex: 0, sliceIndex: 0 });
    expect(part).toContain('viewBox="0 0 50 20"');
    expect(part).toContain('width="50"');
    expect(part).toContain('height="20"');
    expect(siteAnnotationHasFreeInk(annotation)).toBe(true);
    const base = siteAnnotationSvg(annotation);
    expect(base).not.toContain('stroke="#111"');
    expect(base).toContain('fill="#222"');
    expect((part.match(/<svg [^>]+>/)?.[0].match(/\b(?:width|height|viewBox)=/g) ?? []).length).toBe(3);
    const freeStroke = siteAnnotationSvg(annotation, { strokeIndex: 3 });
    expect(freeStroke).toContain('fill="#222"');
    expect(freeStroke).not.toContain('fill="#111"');
  });

  test("keeps free strokes in original order when text parts are split into overlays", () => {
    const annotation: SiteAnnotation = {
      ...valid,
      textParts: [{
        strokeId: 0,
        anchor: valid.anchor!,
        slices: [{ start: 0, end: 4, glyph: { x: 4, y: 5, w: 40, h: 14 }, clip: { x: 0, y: 0, w: 50, h: 20 } }],
      }],
      strokes: [
        valid.strokes[0],
        { ...valid.strokes[0], id: 1, pen: "pen", color: "#222", erase: false },
      ],
    };
    expect(siteAnnotationHasFreeInk(annotation)).toBe(true);
    expect(siteAnnotationSvg(annotation, { strokeIndex: 1 })).toContain('fill="#222"');
  });
});

test('the annotation writer saves media and generic block drawings with conflict protection', async () => {
  const source = readFileSync(new URL('../dev-annotations.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function', 'function');
  for (const type of ['image', 'imageGrid', 'imageCarousel', 'video', 'signup', 'projectDetails']) {
    const section: Record<string, unknown> = { type, id: 'intro' };
    const drawing = { ...valid, kind: 'doodle', anchor: undefined, blockAnchor: { surface: 'block' } };
    let writes = 0;
    const plugin = new Function('readDevDocument', 'resolveEditableDocument', 'writeDevDocument', 'validateSiteAnnotations',
      `${source}; return annotationDevWriter();`)(
      async () => ({ sections: [section] }), () => 'fixture.json', async () => { writes++; }, validateSiteAnnotations,
    );
    let handler: Function;
    plugin.configureServer({ middlewares: { use: (_: string, middleware: Function) => { handler = middleware; } } });
    const request = () => ({ method: 'POST', async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ document: 'fixture', sectionId: 'intro', annotations: [drawing], expected: [] }));
    } });
    const response = { statusCode: 0, setHeader() {}, end() {} };
    await handler!(request(), response, () => {});
    expect(response.statusCode).toBe(200);
    expect(section.annotations).toEqual([JSON.parse(JSON.stringify(drawing))]);
    expect(writes).toBe(1);
    await handler!(request(), response, () => {});
    expect(response.statusCode).toBe(409);
    expect(writes).toBe(1);
  }
});
