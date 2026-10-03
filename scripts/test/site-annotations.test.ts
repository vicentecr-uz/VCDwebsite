import { describe, expect, test } from "bun:test";
import { readFileSync } from 'node:fs';
import { validateSiteAnnotations, type SiteAnnotation } from "../../src/lib/siteAnnotations";

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
