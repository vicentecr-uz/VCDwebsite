import { describe, expect, test } from "bun:test";
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
