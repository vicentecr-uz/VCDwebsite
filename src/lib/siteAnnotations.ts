export type SiteAnnotation = {
  id: string;
  sectionId: string;
  kind: "highlight" | "doodle";
  blockAnchor?: { surface: "block" | "media"; itemPath?: string[] };
  anchor?: {
    paragraphIndex: number;
    exact: string;
    prefix: string;
    suffix: string;
  };
  board: { w: number; h: number };
  box: { x: number; y: number; w: number; h: number };
  strokes: Array<{
    id: number;
    pen:
      | "pencil"
      | "pen"
      | "fineliner"
      | "marker"
      | "highlighter"
      | "brush"
      | "fountain";
    color: string;
    size: number;
    opacity: number;
    points: [number, number, number][];
    shape?: {
      nibAngle?: number;
      taper?: number;
      simulatePressure?: boolean;
    };
    erase?: boolean;
  }>;
  mobile: "show" | "hide";
};

const MAX_ANNOTATIONS = 80;
const MAX_STROKES = 400;
const MAX_POINTS = 10_000;
const MAX_STRING_LENGTH = 2_000;
const MAX_BOARD_EDGE = 100_000;
const MAX_STROKE_SIZE = 10_000;
const PENS = new Set<SiteAnnotation["strokes"][number]["pen"]>([
  "pencil",
  "pen",
  "fineliner",
  "marker",
  "highlighter",
  "brush",
  "fountain",
]);

// Drawesome stores CSS colors. Keep the accepted subset serializable and free of CSS functions
// that could introduce external resources or declarations when the value is rendered.
const COLOR = /^(?:#[\da-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|hsla?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPositiveDimension = (value: unknown, max: number): value is number =>
  isFiniteNumber(value) && value > 0 && value <= max;

const isBoundedString = (value: unknown, allowEmpty = false): value is string =>
  typeof value === "string" &&
  (allowEmpty || value.length > 0) &&
  value.length <= MAX_STRING_LENGTH;

const validateAnchor = (value: unknown): value is NonNullable<SiteAnnotation["anchor"]> => {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.paragraphIndex) &&
    Number.isInteger(value.paragraphIndex) &&
    value.paragraphIndex >= 0 &&
    isBoundedString(value.exact) &&
    isBoundedString(value.prefix, true) &&
    isBoundedString(value.suffix, true)
  );
};

const validateBox = (value: unknown): value is SiteAnnotation["box"] => {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isPositiveDimension(value.w, MAX_BOARD_EDGE) &&
    isPositiveDimension(value.h, MAX_BOARD_EDGE)
  );
};

const validateStroke = (value: unknown): value is SiteAnnotation["strokes"][number] => {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.id) ||
    !Number.isInteger(value.id) ||
    value.id < 0
  ) {
    return false;
  }
  if (
    typeof value.pen !== "string" ||
    !PENS.has(value.pen as SiteAnnotation["strokes"][number]["pen"]) ||
    typeof value.color !== "string" ||
    !COLOR.test(value.color) ||
    !isFiniteNumber(value.size) ||
    value.size <= 0 ||
    value.size > MAX_STROKE_SIZE ||
    !isFiniteNumber(value.opacity) ||
    value.opacity < 0 ||
    value.opacity > 1 ||
    !Array.isArray(value.points) ||
    value.points.length === 0
  ) {
    return false;
  }

  if (
    value.points.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 3 ||
        point.some((coordinate) => !isFiniteNumber(coordinate)),
    )
  ) {
    return false;
  }

  if (value.erase !== undefined && typeof value.erase !== "boolean") return false;
  if (value.shape !== undefined) {
    if (!isRecord(value.shape)) return false;
    if (
      (value.shape.nibAngle !== undefined && !isFiniteNumber(value.shape.nibAngle)) ||
      (value.shape.taper !== undefined &&
        (!isFiniteNumber(value.shape.taper) || value.shape.taper < 0 || value.shape.taper > 1)) ||
      (value.shape.simulatePressure !== undefined &&
        typeof value.shape.simulatePressure !== "boolean")
    ) {
      return false;
    }
  }

  return true;
};

const validateAnnotation = (value: unknown, sectionIds: Set<string>): value is SiteAnnotation => {
  if (!isRecord(value)) return false;
  if (
    !isBoundedString(value.id) ||
    !isBoundedString(value.sectionId) ||
    !sectionIds.has(value.sectionId) ||
    (value.kind !== "highlight" && value.kind !== "doodle") ||
    !isRecord(value.board) ||
    !isPositiveDimension(value.board.w, MAX_BOARD_EDGE) ||
    !isPositiveDimension(value.board.h, MAX_BOARD_EDGE) ||
    !validateBox(value.box) ||
    !Array.isArray(value.strokes) ||
    value.strokes.length === 0 ||
    value.strokes.length > MAX_STROKES ||
    (value.mobile !== "show" && value.mobile !== "hide")
  ) {
    return false;
  }

  if (value.kind === "highlight" && !validateAnchor(value.anchor)) return false;
  if (value.blockAnchor !== undefined) {
    if (value.kind !== "doodle" || value.anchor !== undefined || !isRecord(value.blockAnchor)
      || !["block", "media"].includes(String(value.blockAnchor.surface))
      || (value.blockAnchor.itemPath !== undefined
        && (value.blockAnchor.surface !== "media" || !Array.isArray(value.blockAnchor.itemPath)
          || !value.blockAnchor.itemPath.length || value.blockAnchor.itemPath.length > 8
          || value.blockAnchor.itemPath.some((id) => !isBoundedString(id))))) return false;
  }
  if (value.kind === "doodle" && value.anchor !== undefined && !validateAnchor(value.anchor)) {
    return false;
  }

  let pointCount = 0;
  const strokeIds = new Set<number>();
  for (const stroke of value.strokes) {
    if (!validateStroke(stroke)) return false;
    if (strokeIds.has(stroke.id)) return false;
    strokeIds.add(stroke.id);
    pointCount += stroke.points.length;
    if (pointCount > MAX_POINTS) return false;
  }

  return true;
};

export const validateSiteAnnotations = (
  value: unknown,
  sectionIds: Set<string>,
): value is SiteAnnotation[] => {
  if (!(sectionIds instanceof Set) || !Array.isArray(value) || value.length > MAX_ANNOTATIONS) {
    return false;
  }

  const annotationIds = new Set<string>();
  for (const annotation of value) {
    if (!validateAnnotation(annotation, sectionIds)) return false;
    if (annotationIds.has(annotation.id)) return false;
    annotationIds.add(annotation.id);
  }
  return true;
};
