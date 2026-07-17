// src/internal/parse.ts
var SHAPE_KEYWORDS = {
  round: 1,
  squircle: 2,
  square: Number.POSITIVE_INFINITY,
  bevel: 0,
  scoop: -1,
  notch: Number.NEGATIVE_INFINITY
};
var SHAPE_TOKEN_PATTERN = /superellipse\(\s*(-?infinity|-?\d*\.?\d+(?:e[+-]?\d+)?)\s*\)|round|squircle|square|bevel|scoop|notch/gi;
var PERCENT = 100;
var MAX_SHAPE_VALUES = 4;
var parseSuperellipseArg = (raw) => {
  const lower = raw.toLowerCase();
  if (lower === "infinity") {
    return Number.POSITIVE_INFINITY;
  }
  if (lower === "-infinity") {
    return Number.NEGATIVE_INFINITY;
  }
  return Number.parseFloat(raw);
};
var expandShapes = (values) => {
  const [a, b, c, d] = values;
  if (a === void 0) {
    return null;
  }
  if (b === void 0) {
    return [a, a, a, a];
  }
  if (c === void 0) {
    return [a, b, a, b];
  }
  if (d === void 0) {
    return [a, b, c, b];
  }
  return [a, b, c, d];
};
var parseCornerShape = (value) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const values = [];
  SHAPE_TOKEN_PATTERN.lastIndex = 0;
  let match = SHAPE_TOKEN_PATTERN.exec(trimmed);
  while (match !== null && values.length < MAX_SHAPE_VALUES) {
    const arg = match[1];
    if (arg === void 0) {
      const keyword = SHAPE_KEYWORDS[match[0].toLowerCase()];
      if (keyword !== void 0) {
        values.push(keyword);
      }
    } else {
      const parsed = parseSuperellipseArg(arg);
      if (!Number.isNaN(parsed)) {
        values.push(parsed);
      }
    }
    match = SHAPE_TOKEN_PATTERN.exec(trimmed);
  }
  return expandShapes(values);
};
var ZERO_COMPONENT = { value: 0, isPercent: false };
var WHITESPACE_PATTERN = /\s+/;
var parseRadiusComponent = (raw) => {
  if (!raw) {
    return ZERO_COMPONENT;
  }
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) {
    return ZERO_COMPONENT;
  }
  return { value, isPercent: raw.includes("%") };
};
var parseRadiusLonghand = (value) => {
  const parts = value.trim().split(WHITESPACE_PATTERN);
  const x = parseRadiusComponent(parts[0]);
  const y = parts.length > 1 ? parseRadiusComponent(parts[1]) : x;
  return { x, y };
};
var resolveComponent = (component, basis) => component.isPercent ? component.value / PERCENT * basis : component.value;
var resolveRadii = (radii, width, height) => {
  const resolved = radii.map((radius) => ({
    rx: Math.max(resolveComponent(radius.x, width), 0),
    ry: Math.max(resolveComponent(radius.y, height), 0)
  }));
  const [tl, tr, br, bl] = resolved;
  const ratios = [
    width / (tl.rx + tr.rx || 1),
    height / (tr.ry + br.ry || 1),
    width / (br.rx + bl.rx || 1),
    height / (bl.ry + tl.ry || 1)
  ];
  const scale = Math.min(1, ...ratios);
  if (scale < 1) {
    for (const radius of resolved) {
      radius.rx *= scale;
      radius.ry *= scale;
    }
  }
  return resolved;
};
var splitTopLevel = (value, separator) => {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }
    if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
};
var LENGTH_PATTERN = /-?\d*\.?\d+px/g;
var DEFAULT_SHADOW_COLOR = "rgba(0,0,0,0.35)";
var parseSingleShadow = (raw) => {
  if (raw.includes("inset")) {
    return null;
  }
  LENGTH_PATTERN.lastIndex = 0;
  const lengths = raw.match(LENGTH_PATTERN) ?? [];
  const [x = "0px", y = "0px", blur = "0px", spread = "0px"] = lengths;
  const color = raw.replace(LENGTH_PATTERN, "").trim() || DEFAULT_SHADOW_COLOR;
  return {
    x: Number.parseFloat(x),
    y: Number.parseFloat(y),
    blur: Number.parseFloat(blur),
    spread: Number.parseFloat(spread),
    color
  };
};
var parseBoxShadow = (value) => {
  if (!value || value === "none") {
    return [];
  }
  const shadows = [];
  for (const part of splitTopLevel(value, ",")) {
    const shadow = parseSingleShadow(part);
    if (shadow) {
      shadows.push(shadow);
    }
  }
  return shadows;
};
var expandLayerList = (value, count) => {
  const parts = splitTopLevel(value, ",");
  if (parts.length === 0) {
    return [];
  }
  const expanded = [];
  for (let i = 0; i < count; i += 1) {
    expanded.push(parts[i % parts.length] ?? "");
  }
  return expanded;
};
var TRANSPARENT_PATTERN = /^(?:transparent|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|rgba?\(0,\s*0,\s*0,\s*0\))$/i;
var isTransparentColor = (color) => TRANSPARENT_PATTERN.test(color.trim());

// src/internal/scan.ts
var CORNER_SHAPE_VAR = "--corner-shape";
var CORNER_SCALE_VAR = "--corner-scale";
var RADIUS_PROPS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius"
];
var readRules = (sheet) => {
  if (!sheet) {
    return null;
  }
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
};
var collectEntries = (rules, conditions, entries) => {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      entries.push({
        selector: rule.selectorText,
        style: rule.style,
        conditions
      });
      continue;
    }
    if (rule instanceof CSSImportRule) {
      const imported = readRules(rule.styleSheet);
      if (imported) {
        const media = rule.media.mediaText;
        const next = media ? [...conditions, `@media ${media}`] : conditions;
        collectEntries(imported, next, entries);
      }
      continue;
    }
    if (rule instanceof CSSMediaRule) {
      collectEntries(
        rule.cssRules,
        [...conditions, `@media ${rule.conditionText}`],
        entries
      );
      continue;
    }
    if (rule instanceof CSSSupportsRule) {
      collectEntries(
        rule.cssRules,
        [...conditions, `@supports ${rule.conditionText}`],
        entries
      );
      continue;
    }
    const grouping = rule;
    if (grouping.cssRules) {
      collectEntries(grouping.cssRules, conditions, entries);
    }
  }
};
var collectRadiusDeclarations = (style) => {
  const declarations = [];
  for (const prop of RADIUS_PROPS) {
    const value = style.getPropertyValue(prop).trim();
    if (value && style.getPropertyPriority(prop) !== "important") {
      declarations.push([prop, value]);
    }
  }
  return declarations;
};
var scanDocument = (doc) => {
  const entries = [];
  for (const sheet of doc.styleSheets) {
    const ownerNode = sheet.ownerNode;
    if (ownerNode instanceof Element && ownerNode.hasAttribute("data-hyperellipse")) {
      continue;
    }
    const rules = readRules(sheet);
    if (rules) {
      collectEntries(rules, [], entries);
    }
  }
  const selectorSet = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    if (entry.style.getPropertyValue(CORNER_SHAPE_VAR).trim()) {
      selectorSet.add(entry.selector);
    }
  }
  const pendingRules = [];
  for (const entry of entries) {
    if (!selectorSet.has(entry.selector)) {
      continue;
    }
    const declarations = collectRadiusDeclarations(entry.style);
    if (declarations.length > 0) {
      pendingRules.push({
        selector: entry.selector,
        conditions: entry.conditions,
        declarations
      });
    }
  }
  return { selectors: [...selectorSet], pendingRules };
};

// src/internal/pending.ts
var WHITESPACE_PATTERN2 = /\s+/;
var scaleRadiusValue = (value, scale) => {
  const sides = splitTopLevel(value, "/");
  const scaledSides = sides.map(
    (side) => side.split(WHITESPACE_PATTERN2).filter(Boolean).map((token) => `calc((${token}) * ${scale})`).join(" ")
  );
  return scaledSides.join(" / ");
};
var wrapConditions = (body, conditions) => {
  let wrapped = body;
  for (let i = conditions.length - 1; i >= 0; i -= 1) {
    wrapped = `${conditions[i]}{${wrapped}}`;
  }
  return wrapped;
};
var buildPendingCss = (rules, scale) => {
  const chunks = [];
  for (const rule of rules) {
    const declarations = rule.declarations.filter(([, value]) => !value.includes(CORNER_SCALE_VAR)).map(([prop, value]) => `${prop}:${scaleRadiusValue(value, scale)};`).join("");
    if (declarations) {
      chunks.push(
        wrapConditions(`${rule.selector}{${declarations}}`, rule.conditions)
      );
    }
  }
  return chunks.join("\n");
};
var createManagedSheet = (doc, marker) => {
  const style = doc.createElement("style");
  style.setAttribute("data-hyperellipse", marker);
  doc.head.appendChild(style);
  return {
    update: (css) => {
      if (style.textContent !== css) {
        style.textContent = css;
      }
    },
    bump: () => {
      if (doc.head.lastElementChild !== style) {
        doc.head.appendChild(style);
      }
    },
    setDisabled: (disabled) => {
      if (style.sheet) {
        style.sheet.disabled = disabled;
      }
    },
    remove: () => {
      style.remove();
    }
  };
};

// src/internal/geometry.ts
// VCD patch: emit cubic Béziers instead of L polylines so fallback corners stay
// smooth at any zoom. Upstream hyperellipse@1.0.5 used straight segments (max 26
// per corner), which read as facets in Firefox/Safari.
//
// Path construction uses Hermite cubics with axis-aligned end tangents (matching
// the incoming/outgoing straight edges). An earlier Catmull–Rom attempt pulled the
// first control point inward and left a 1px “nub” where the flat met the curve.
var HALF = 0.5;
var COORD_PRECISION = 100;
var MIN_CORNER_SEGMENTS = 8;
var MAX_CORNER_SEGMENTS = 48;
var SEGMENTS_PER_PIXEL = 0.75;
var fmt = (value) => String(Math.round(value * COORD_PRECISION) / COORD_PRECISION);
var cosineSpaced = (t) => (1 - Math.cos(Math.PI * t)) * HALF;
var segmentCount = (corner) => {
  if (corner.shape === 0) {
    return 1;
  }
  const size = Math.max(corner.rx, corner.ry);
  return Math.min(
    MAX_CORNER_SEGMENTS,
    Math.max(MIN_CORNER_SEGMENTS, Math.ceil(size * SEGMENTS_PER_PIXEL))
  );
};
var vecSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
var vecAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
var vecScale = (a, s) => ({ x: a.x * s, y: a.y * s });
var vecLen = (a) => Math.hypot(a.x, a.y);
var vecNormalize = (a) => {
  const length = vecLen(a);
  return length > 0 ? { x: a.x / length, y: a.y / length } : { x: 0, y: 0 };
};
/** Unit tangents at samples: ends follow edge directions; mids use central differences. */
var cornerTangents = (points, inDir, outDir) => {
  const n = points.length;
  const tangents = new Array(n);
  for (let i = 0; i < n; i += 1) {
    if (i === 0) {
      tangents[i] = vecNormalize(inDir);
    } else if (i === n - 1) {
      tangents[i] = vecNormalize(outDir);
    } else {
      tangents[i] = vecNormalize(vecSub(points[i + 1], points[i - 1]));
    }
  }
  return tangents;
};
/** Open sample polyline → Hermite cubic commands. Path must already be at points[0]. */
var pointsToCubicCommands = (points, inDir, outDir) => {
  if (points.length <= 1) {
    return [];
  }
  if (points.length === 2) {
    return [`L ${fmt(points[1].x)} ${fmt(points[1].y)}`];
  }
  const tangents = cornerTangents(points, inDir, outDir);
  const cmds = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const chord = vecLen(vecSub(p1, p0));
    const cp1 = vecAdd(p0, vecScale(tangents[i], chord / 3));
    const cp2 = vecAdd(p1, vecScale(tangents[i + 1], -chord / 3));
    cmds.push(
      `C ${fmt(cp1.x)} ${fmt(cp1.y)} ${fmt(cp2.x)} ${fmt(cp2.y)} ${fmt(p1.x)} ${fmt(p1.y)}`
    );
  }
  return cmds;
};
var innerCenter = (start, end, outer) => ({
  x: start.x + end.x - outer.x,
  y: start.y + end.y - outer.y
});
var cornerPoints = (start, end, outer, corner) => {
  if (corner.rx <= 0 || corner.ry <= 0 || corner.shape === Number.POSITIVE_INFINITY) {
    return [outer];
  }
  if (corner.shape === Number.NEGATIVE_INFINITY) {
    return [start, innerCenter(start, end, outer), end];
  }
  const exponent = HALF ** Math.abs(corner.shape);
  const center = corner.shape < 0 ? outer : innerCenter(start, end, outer);
  const points = [start];
  const segments = segmentCount(corner);
  for (let i = 1; i < segments; i += 1) {
    const t = cosineSpaced(i / segments);
    const fx = t ** exponent;
    const fy = (1 - t) ** exponent;
    points.push({
      x: center.x + (end.x - center.x) * fx + (start.x - center.x) * fy,
      y: center.y + (end.y - center.y) * fx + (start.y - center.y) * fy
    });
  }
  points.push(end);
  return points;
};
var buildShapePath = (box, corners) => {
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const [tl, tr, br, bl] = corners;
  const arcs = [
    cornerPoints(
      { x: right - tr.rx, y: top },
      { x: right, y: top + tr.ry },
      { x: right, y: top },
      tr
    ),
    cornerPoints(
      { x: right, y: bottom - br.ry },
      { x: right - br.rx, y: bottom },
      { x: right, y: bottom },
      br
    ),
    cornerPoints(
      { x: left + bl.rx, y: bottom },
      { x: left, y: bottom - bl.ry },
      { x: left, y: bottom },
      bl
    ),
    cornerPoints(
      { x: left, y: top + tl.ry },
      { x: left + tl.rx, y: top },
      { x: left, y: top },
      tl
    )
  ];
  const tlArc = arcs[3];
  const startPoint = tlArc?.at(-1) ?? { x: left, y: top };
  const segments = [`M ${fmt(startPoint.x)} ${fmt(startPoint.y)}`];
  let cursor = startPoint;
  for (let ai = 0; ai < arcs.length; ai += 1) {
    const arc = arcs[ai];
    if (arc.length === 0) {
      continue;
    }
    const first = arc[0];
    const last = arc[arc.length - 1];
    const nextArc = arcs[(ai + 1) % arcs.length];
    // Straight side into the corner, then Hermite cubics with edge-aligned tangents.
    segments.push(`L ${fmt(first.x)} ${fmt(first.y)}`);
    const inDir = vecSub(first, cursor);
    const outDir = nextArc.length > 0 ? vecSub(nextArc[0], last) : inDir;
    segments.push(...pointsToCubicCommands(arc, inDir, outDir));
    cursor = last;
  }
  segments.push("Z");
  return segments.join(" ");
};
var offsetCorners = (corners, delta) => corners.map((corner) => ({
  shape: corner.shape,
  rx: corner.rx > 0 ? Math.max(corner.rx + delta, 0) : 0,
  ry: corner.ry > 0 ? Math.max(corner.ry + delta, 0) : 0
}));
var clampUnit = (value) => Math.min(Math.max(value, -1), 1);
var normalizedHalfCorner = (shape) => {
  if (shape === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (shape === Number.POSITIVE_INFINITY) {
    return 1;
  }
  const k = HALF ** Math.abs(shape);
  const convex = HALF ** k;
  return shape < 0 ? 1 - convex : convex;
};
var rotate90 = (point, steps) => {
  let { x, y } = point;
  const turns = (steps % 4 + 4) % 4;
  for (let i = 0; i < turns; i += 1) {
    const nextX = -y;
    y = x;
    x = nextX;
  }
  return { x, y };
};
var alignedCornerPoint = (origin, offset, thickness, orientation) => {
  const length = Math.hypot(offset.x, offset.y) || 1;
  const rotated = rotate90(offset, orientation);
  return {
    x: origin.x + rotated.x / length * thickness,
    y: origin.y + rotated.y / length * thickness
  };
};
var clockwiseQuad = (box) => [
  { x: box.x, y: box.y },
  { x: box.x + box.width, y: box.y },
  { x: box.x + box.width, y: box.y + box.height },
  { x: box.x, y: box.y + box.height }
];
var projectCornerPoint = (normalized, rect, orientation) => {
  const centered = rotate90(
    { x: normalized.x - HALF, y: normalized.y - HALF },
    orientation
  );
  return {
    x: rect.x + (centered.x + HALF) * rect.width,
    y: rect.y + (centered.y + HALF) * rect.height
  };
};
var contourCornerPoints = (cornerRect, orientation, startThickness, endThickness, shape) => {
  const quad = clockwiseQuad(cornerRect);
  const vertex = quad[(orientation + 1) % 4];
  if (cornerRect.width <= 0 || cornerRect.height <= 0 || shape === Number.POSITIVE_INFINITY) {
    return [vertex];
  }
  const half = normalizedHalfCorner(clampUnit(shape));
  const control = half * 2 - HALF;
  const start = alignedCornerPoint(
    quad[orientation],
    { x: control, y: 1 - control },
    startThickness,
    orientation + 1
  );
  const end = alignedCornerPoint(
    quad[(orientation + 2) % 4],
    { x: control - 1, y: -control },
    endThickness,
    orientation + 3
  );
  if (shape === Number.NEGATIVE_INFINITY) {
    return [
      start,
      { x: start.x + end.x - vertex.x, y: start.y + end.y - vertex.y },
      end
    ];
  }
  const rect = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
  const exponent = HALF ** Math.abs(shape);
  const segments = segmentCount({
    rx: rect.width,
    ry: rect.height,
    shape
  });
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = cosineSpaced(i / segments);
    const a = t ** exponent;
    const b = 1 - (1 - t) ** exponent;
    const normalized = shape > 0 ? { x: a, y: b } : { x: b, y: a };
    points.push(projectCornerPoint(normalized, rect, orientation));
  }
  return points;
};
var CLIP_EPSILON = 1e-4;
var interpolate = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});
var clipPolygonToRect = (polygon, rect) => {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const edges = [
    {
      inside: (p) => p.x >= left - CLIP_EPSILON,
      intersect: (a, b) => interpolate(a, b, (left - a.x) / (b.x - a.x))
    },
    {
      inside: (p) => p.x <= right + CLIP_EPSILON,
      intersect: (a, b) => interpolate(a, b, (right - a.x) / (b.x - a.x))
    },
    {
      inside: (p) => p.y >= top - CLIP_EPSILON,
      intersect: (a, b) => interpolate(a, b, (top - a.y) / (b.y - a.y))
    },
    {
      inside: (p) => p.y <= bottom + CLIP_EPSILON,
      intersect: (a, b) => interpolate(a, b, (bottom - a.y) / (b.y - a.y))
    }
  ];
  let output = polygon;
  for (const edge of edges) {
    if (output.length === 0) {
      break;
    }
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      const currentInside = edge.inside(current);
      const previousInside = edge.inside(previous);
      if (currentInside) {
        if (!previousInside) {
          output.push(edge.intersect(previous, current));
        }
        output.push(current);
      } else if (previousInside) {
        output.push(edge.intersect(previous, current));
      }
    }
  }
  return output;
};
var polygonToPath = (points) => {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)} Z`;
  }
  if (points.length === 2) {
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)} Z`;
  }
  // Closed Hermite cubics (edge-aligned via wraparound central differences).
  const n = points.length;
  const tangents = new Array(n);
  for (let i = 0; i < n; i += 1) {
    tangents[i] = vecNormalize(vecSub(points[(i + 1) % n], points[(i - 1 + n) % n]));
  }
  const segments = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 0; i < n; i += 1) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    const chord = vecLen(vecSub(p1, p0));
    const cp1 = vecAdd(p0, vecScale(tangents[i], chord / 3));
    const cp2 = vecAdd(p1, vecScale(tangents[(i + 1) % n], -chord / 3));
    segments.push(
      `C ${fmt(cp1.x)} ${fmt(cp1.y)} ${fmt(cp2.x)} ${fmt(cp2.y)} ${fmt(p1.x)} ${fmt(p1.y)}`
    );
  }
  segments.push("Z");
  return segments.join(" ");
};
var contourPath = (outerBox, corners, target) => {
  const left = outerBox.x;
  const top = outerBox.y;
  const right = outerBox.x + outerBox.width;
  const bottom = outerBox.y + outerBox.height;
  const targetLeft = target.x;
  const targetTop = target.y;
  const targetRight = target.x + target.width;
  const targetBottom = target.y + target.height;
  const [tl, tr, br, bl] = corners;
  const points = [
    ...contourCornerPoints(
      { x: right - tr.rx, y: top, width: tr.rx, height: tr.ry },
      0,
      targetTop - top,
      right - targetRight,
      tr.shape
    ),
    ...contourCornerPoints(
      { x: right - br.rx, y: bottom - br.ry, width: br.rx, height: br.ry },
      1,
      right - targetRight,
      bottom - targetBottom,
      br.shape
    ),
    ...contourCornerPoints(
      { x: left, y: bottom - bl.ry, width: bl.rx, height: bl.ry },
      2,
      bottom - targetBottom,
      targetLeft - left,
      bl.shape
    ),
    ...contourCornerPoints(
      { x: left, y: top, width: tl.rx, height: tl.ry },
      3,
      targetLeft - left,
      targetTop - top,
      tl.shape
    )
  ];
  return polygonToPath(clipPolygonToRect(points, target));
};

// src/internal/render.ts
var ROUND_SHAPE = 1;
var BLUR_STD_DEV_RATIO = 0.5;
var RADIUS_LONGHANDS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius"
];
var readBorder = (cs) => {
  const width = Number.parseFloat(cs.borderTopWidth) || 0;
  const style = cs.borderTopStyle;
  const color = cs.borderTopColor;
  const visible = width > 0 && style !== "none" && style !== "hidden" && !isTransparentColor(color);
  return { width, color, visible };
};
var readOutline = (cs) => {
  const style = cs.outlineStyle;
  const width = Number.parseFloat(cs.outlineWidth) || 0;
  if (style === "none" || width <= 0 || isTransparentColor(cs.outlineColor)) {
    return null;
  }
  return {
    width,
    color: cs.outlineColor,
    offset: Number.parseFloat(cs.outlineOffset) || 0
  };
};
var readShapes = (element, cs) => {
  const attrValue = element.getAttribute("data-corner-shape");
  const raw = attrValue?.trim() ? attrValue : cs.getPropertyValue(CORNER_SHAPE_VAR);
  const shapes = parseCornerShape(raw);
  if (!shapes) {
    return null;
  }
  if (shapes.every((shape) => shape === ROUND_SHAPE)) {
    return null;
  }
  return shapes;
};
var readSource = (element) => {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return null;
  }
  const cs = view.getComputedStyle(element);
  const shapes = readShapes(element, cs);
  if (!shapes) {
    return null;
  }
  return {
    shapes,
    radii: RADIUS_LONGHANDS.map(
      (prop) => parseRadiusLonghand(cs.getPropertyValue(prop))
    ),
    border: readBorder(cs),
    shadows: parseBoxShadow(cs.boxShadow),
    outline: readOutline(cs),
    background: {
      color: cs.backgroundColor,
      image: cs.backgroundImage,
      position: cs.backgroundPosition,
      size: cs.backgroundSize,
      repeat: cs.backgroundRepeat,
      origin: cs.backgroundOrigin,
      clip: cs.backgroundClip,
      attachment: cs.backgroundAttachment
    },
    position: cs.position
  };
};
var CLEAR_TARGET = {
  key: "",
  styles: {},
  hostAttr: "",
  images: []
};
var svgDataUri = (width, height, body) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
var cssUrl = (uri) => `url("${uri}")`;
var ringPathMarkup = (x, y, width, height, corners, border) => {
  const bw = border.width;
  const box = { x, y, width, height };
  const outer = buildShapePath(box, corners);
  const innerWidth = width - bw * 2;
  const innerHeight = height - bw * 2;
  if (innerWidth <= 0 || innerHeight <= 0) {
    return `<path d="${outer}" fill="${border.color}"/>`;
  }
  const inner = contourPath(box, corners, {
    x: x + bw,
    y: y + bw,
    width: innerWidth,
    height: innerHeight
  });
  return `<path d="${outer} ${inner}" fill="${border.color}" fill-rule="evenodd"/>`;
};
var buildRingSvg = (width, height, corners, border) => svgDataUri(
  width,
  height,
  ringPathMarkup(0, 0, width, height, corners, border)
);
var OUTLINE_MITER_LIMIT = 12;
var OUTLINE_SEAM_BLEED = 1;
var buildOutlineSvg = (width, height, corners, outline) => {
  const bleed = outline.offset <= 0 ? OUTLINE_SEAM_BLEED : 0;
  const offset = Math.max(outline.offset, 0);
  const spread = offset + outline.width;
  const extent = spread;
  const canvasWidth = width + spread * 2;
  const canvasHeight = height + spread * 2;
  const shapeBox = { x: spread, y: spread, width, height };
  const shape = buildShapePath(shapeBox, corners);
  const join = `stroke-linejoin="miter" stroke-miterlimit="${OUTLINE_MITER_LIMIT}"`;
  const outerDilation = `<path d="${shape}" fill="#fff" stroke="#fff" stroke-width="${spread * 2}" ${join}/>`;
  const innerDistance = offset - bleed;
  let innerHole;
  if (innerDistance > 0) {
    innerHole = `<path d="${shape}" fill="#000" stroke="#000" stroke-width="${innerDistance * 2}" ${join}/>`;
  } else if (innerDistance === 0) {
    innerHole = `<path d="${shape}" fill="#000"/>`;
  } else {
    const erosion = -innerDistance;
    const eroded = contourPath(shapeBox, corners, {
      x: shapeBox.x + erosion,
      y: shapeBox.y + erosion,
      width: width - erosion * 2,
      height: height - erosion * 2
    });
    innerHole = `<path d="${eroded}" fill="#000"/>`;
  }
  const mask = `<mask id="ho" maskUnits="userSpaceOnUse" x="0" y="0" width="${canvasWidth}" height="${canvasHeight}">${outerDilation}${innerHole}</mask>`;
  const body = `<defs>${mask}</defs><rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="${outline.color}" mask="url(#ho)"/>`;
  return { uri: svgDataUri(canvasWidth, canvasHeight, body), extent };
};
var shadowMargins = (shadows) => {
  const margins = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const shadow of shadows) {
    const reach = shadow.blur + Math.max(shadow.spread, 0);
    margins.left = Math.max(margins.left, reach - shadow.x);
    margins.right = Math.max(margins.right, reach + shadow.x);
    margins.top = Math.max(margins.top, reach - shadow.y);
    margins.bottom = Math.max(margins.bottom, reach + shadow.y);
  }
  return margins;
};
var shadowMarkup = (shadow, index, margins, width, height, canvasWidth, canvasHeight, corners) => {
  const box = {
    x: margins.left + shadow.x - shadow.spread,
    y: margins.top + shadow.y - shadow.spread,
    width: width + shadow.spread * 2,
    height: height + shadow.spread * 2
  };
  if (box.width <= 0 || box.height <= 0) {
    return null;
  }
  const path = buildShapePath(box, offsetCorners(corners, shadow.spread));
  if (shadow.blur <= 0) {
    return { def: "", body: `<path d="${path}" fill="${shadow.color}"/>` };
  }
  const id = `b${index}`;
  const def = `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${canvasWidth}" height="${canvasHeight}"><feGaussianBlur stdDeviation="${shadow.blur * BLUR_STD_DEV_RATIO}"/></filter>`;
  const body = `<path d="${path}" fill="${shadow.color}" filter="url(#${id})"/>`;
  return { def, body };
};
var buildLayerSvg = (width, height, corners, source) => {
  const margins = shadowMargins(source.shadows);
  const canvasWidth = width + margins.left + margins.right;
  const canvasHeight = height + margins.top + margins.bottom;
  const defs = [];
  const body = [];
  for (let i = source.shadows.length - 1; i >= 0; i -= 1) {
    const shadow = source.shadows[i];
    if (!shadow) {
      continue;
    }
    const markup = shadowMarkup(
      shadow,
      i,
      margins,
      width,
      height,
      canvasWidth,
      canvasHeight,
      corners
    );
    if (markup) {
      if (markup.def) {
        defs.push(markup.def);
      }
      body.push(markup.body);
    }
  }
  const fillPath = buildShapePath(
    { x: margins.left, y: margins.top, width, height },
    corners
  );
  body.push(`<path d="${fillPath}" fill="${source.background.color}"/>`);
  if (source.border.visible) {
    body.push(
      ringPathMarkup(
        margins.left,
        margins.top,
        width,
        height,
        corners,
        source.border
      )
    );
  }
  const defsMarkup = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";
  const borderWidth = source.border.width;
  return {
    uri: svgDataUri(canvasWidth, canvasHeight, defsMarkup + body.join("")),
    inset: `${-(margins.top + borderWidth)}px ${-(margins.right + borderWidth)}px ${-(margins.bottom + borderWidth)}px ${-(margins.left + borderWidth)}px`
  };
};
var composeBackground = (background, layer) => {
  const hasImages = background.image !== "none";
  const layerCount = hasImages ? splitTopLevel(background.image, ",").length : 0;
  const compose = (own, existing) => {
    if (layerCount === 0) {
      return own;
    }
    return `${own}, ${expandLayerList(existing, layerCount).join(", ")}`;
  };
  return {
    "background-image": compose(layer, background.image),
    "background-position": compose("0px 0px", background.position),
    "background-size": compose("100% 100%", background.size),
    "background-repeat": compose("no-repeat", background.repeat),
    "background-origin": compose("border-box", background.origin),
    "background-clip": compose("border-box", background.clip),
    "background-attachment": compose("scroll", background.attachment)
  };
};
var computeClipTarget = (source, width, height, corners) => {
  const path = buildShapePath({ x: 0, y: 0, width, height }, corners);
  const clip = `path("${path}")`;
  const styles = {
    "clip-path": clip,
    "-webkit-clip-path": clip,
    "border-radius": "0px"
  };
  const images = [];
  if (source.border.visible) {
    const ring = buildRingSvg(width, height, corners, source.border);
    images.push(ring);
    Object.assign(styles, composeBackground(source.background, cssUrl(ring)));
    styles["border-color"] = "transparent";
  }
  return {
    key: `clip|${clip}|${styles["background-image"] ?? ""}`,
    styles,
    hostAttr: "",
    images
  };
};
var computeLayerTarget = (source, width, height, corners) => {
  const layer = buildLayerSvg(width, height, corners, source);
  const images = [layer.uri];
  const styles = {
    "border-radius": "0px",
    "background-color": "transparent",
    isolation: "isolate",
    "--hyperellipse-layer-image": cssUrl(layer.uri),
    "--hyperellipse-layer-inset": layer.inset
  };
  if (source.position === "static") {
    styles.position = "relative";
  }
  if (source.border.visible) {
    styles["border-color"] = "transparent";
  }
  if (source.shadows.length > 0) {
    styles["box-shadow"] = "none";
  }
  let hostAttr = "layer";
  let outlineUri = "";
  if (source.outline) {
    const { uri, extent } = buildOutlineSvg(
      width,
      height,
      corners,
      source.outline
    );
    outlineUri = uri;
    images.push(uri);
    styles["--hyperellipse-outline-image"] = cssUrl(uri);
    styles["--hyperellipse-outline-inset"] = `${-(extent + source.border.width)}px`;
    styles["outline-color"] = "transparent";
    hostAttr = "layer outline";
  }
  return {
    key: `layer|${layer.uri}|${outlineUri}`,
    styles,
    hostAttr,
    images
  };
};
var computeTarget = (source, width, height) => {
  const resolved = resolveRadii(source.radii, width, height);
  const corners = resolved.map((radius, index) => ({
    rx: radius.rx,
    ry: radius.ry,
    shape: source.shapes[index] ?? ROUND_SHAPE
  }));
  if (corners.every((corner) => corner.rx <= 0 || corner.ry <= 0)) {
    return CLEAR_TARGET;
  }
  const needsLayerMode = source.shadows.length > 0 || source.outline !== null;
  return needsLayerMode ? computeLayerTarget(source, width, height, corners) : computeClipTarget(source, width, height, corners);
};
var PSEUDO_BASE_CSS = `[data-hyperellipse-host~="layer"]::before{content:"";position:absolute;inset:var(--hyperellipse-layer-inset,0);z-index:-1;background-image:var(--hyperellipse-layer-image,none);background-size:100% 100%;background-repeat:no-repeat;background-origin:border-box;pointer-events:none;}
[data-hyperellipse-host~="outline"]::after{content:"";position:absolute;inset:var(--hyperellipse-outline-inset,0);background-image:var(--hyperellipse-outline-image,none);background-size:100% 100%;background-repeat:no-repeat;background-origin:border-box;pointer-events:none;}`;
var HOST_ATTR = "data-hyperellipse-host";

// src/internal/engine.ts
var BASE_SELECTORS = ["[data-corner-shape]", '[style*="--corner-shape"]'];
var createEntry = () => ({
  source: null,
  key: "",
  applied: {},
  seq: 0,
  snapshot: "",
  hostAttr: "",
  inView: true,
  pendingDirty: false
});
var DECODED_CACHE_LIMIT = 256;
var NATIVE_SUPPRESSIONS = [
  "border-color",
  "outline-color",
  "box-shadow"
];
var isValidSelector = (doc, selector) => {
  try {
    doc.querySelector(selector);
    return true;
  } catch {
    return false;
  }
};
var isStyleNode = (node) => node instanceof Element && (node.tagName === "STYLE" || node.tagName === "LINK");
var createEngine = (doc, options) => {
  const entries = /* @__PURE__ */ new WeakMap();
  const tracked = /* @__PURE__ */ new Set();
  const dirty = /* @__PURE__ */ new Set();
  const decodedImages = /* @__PURE__ */ new Set();
  let selectorString = BASE_SELECTORS.join(", ");
  let flushScheduled = false;
  let rescanScheduled = false;
  let rafId = 0;
  let destroyed = false;
  const pendingSheet = createManagedSheet(doc, "pending");
  const baseSheet = createManagedSheet(doc, "base");
  baseSheet.update(PSEUDO_BASE_CSS);
  const readSheet = createManagedSheet(doc, "read");
  readSheet.update(`*{${CORNER_SCALE_VAR}:1 !important;}`);
  readSheet.setDisabled(true);
  const resizeObserver = new ResizeObserver((roEntries) => {
    for (const roEntry of roEntries) {
      const element = roEntry.target;
      if (!(element instanceof HTMLElement && tracked.has(element))) {
        continue;
      }
      const entry = entries.get(element);
      if (entry && intersectionObserver && !entry.inView) {
        entry.pendingDirty = true;
        continue;
      }
      if (entry?.source) {
        handleResize(element, entry);
      } else {
        dirty.add(element);
        scheduleFlush();
      }
    }
  });
  const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((ioEntries) => {
    for (const ioEntry of ioEntries) {
      const element = ioEntry.target;
      if (!(element instanceof HTMLElement && tracked.has(element))) {
        continue;
      }
      const entry = entries.get(element);
      if (!entry) {
        continue;
      }
      const wasInView = entry.inView;
      entry.inView = ioEntry.isIntersecting;
      if (entry.inView && (!wasInView || entry.pendingDirty)) {
        entry.pendingDirty = false;
        dirty.add(element);
        scheduleFlush();
      }
    }
  });
  const scheduleFlush = () => {
    if (flushScheduled || destroyed) {
      return;
    }
    flushScheduled = true;
    rafId = requestAnimationFrame(flush);
  };
  const markDirty = (element) => {
    const entry = entries.get(element);
    if (entry && intersectionObserver && !entry.inView) {
      entry.pendingDirty = true;
      return;
    }
    dirty.add(element);
    scheduleFlush();
  };
  const detachHoverListeners = (entry) => {
    entry.hoverCleanup?.();
  };
  const attachHoverListeners = (element, entry) => {
    const handler = () => {
      markDirty(element);
    };
    const nodes = [];
    for (let node = element; node; node = node.parentElement) {
      node.addEventListener("mouseenter", handler);
      node.addEventListener("mouseleave", handler);
      nodes.push(node);
    }
    entry.hoverCleanup = () => {
      for (const node of nodes) {
        node.removeEventListener("mouseenter", handler);
        node.removeEventListener("mouseleave", handler);
      }
      entry.hoverCleanup = void 0;
    };
  };
  const track = (element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    if (!tracked.has(element)) {
      tracked.add(element);
      const entry = entries.get(element) ?? createEntry();
      entries.set(element, entry);
      resizeObserver.observe(element);
      intersectionObserver?.observe(element);
      attachHoverListeners(element, entry);
    }
    markDirty(element);
  };
  const untrack = (element) => {
    const entry = entries.get(element);
    if (entry) {
      detachHoverListeners(entry);
    }
    tracked.delete(element);
    dirty.delete(element);
    resizeObserver.unobserve(element);
    intersectionObserver?.unobserve(element);
  };
  const trackQueryResults = (root) => {
    for (const element of root.querySelectorAll(selectorString)) {
      track(element);
    }
  };
  const refreshAll = () => {
    for (const element of tracked) {
      const entry = entries.get(element);
      if (entry && intersectionObserver && !entry.inView) {
        entry.pendingDirty = true;
      } else {
        dirty.add(element);
      }
    }
    scheduleFlush();
  };
  const removeApplied = (element, entry) => {
    for (const prop of Object.keys(entry.applied)) {
      element.style.removeProperty(prop);
    }
  };
  const restoreApplied = (element, entry) => {
    for (const [prop, value] of Object.entries(entry.applied)) {
      element.style.setProperty(prop, value);
    }
    entry.snapshot = element.getAttribute("style") ?? "";
  };
  const clearOwned = (element, entry) => {
    entry.seq += 1;
    removeApplied(element, entry);
    if (entry.hostAttr) {
      element.removeAttribute(HOST_ATTR);
    }
    entry.applied = {};
    entry.key = "";
    entry.hostAttr = "";
    element.style.setProperty(CORNER_SCALE_VAR, "1");
    entry.applied[CORNER_SCALE_VAR] = "1";
    entry.snapshot = element.getAttribute("style") ?? "";
  };
  const applyNativeSuppressions = (element, entry, target) => {
    if (target === CLEAR_TARGET) {
      return;
    }
    let changed = false;
    for (const prop of NATIVE_SUPPRESSIONS) {
      const value = target.styles[prop];
      if (value !== void 0 && entry.applied[prop] !== value) {
        element.style.setProperty(prop, value);
        entry.applied[prop] = value;
        changed = true;
      }
    }
    if (changed) {
      entry.snapshot = element.getAttribute("style") ?? "";
    }
  };
  const applyTarget = (element, entry, target) => {
    entry.seq += 1;
    if (target === CLEAR_TARGET) {
      clearOwned(element, entry);
      entry.snapshot = element.getAttribute("style") ?? "";
      return;
    }
    if (target.key === entry.key) {
      return;
    }
    for (const prop of Object.keys(entry.applied)) {
      if (!(prop in target.styles)) {
        element.style.removeProperty(prop);
      }
    }
    for (const [prop, value] of Object.entries(target.styles)) {
      element.style.setProperty(prop, value);
    }
    const hostChanging = target.hostAttr !== entry.hostAttr;
    if (hostChanging) {
      if (target.hostAttr) {
        element.getBoundingClientRect();
        element.setAttribute(HOST_ATTR, target.hostAttr);
      } else {
        element.removeAttribute(HOST_ATTR);
      }
    }
    entry.applied = { ...target.styles };
    entry.key = target.key;
    entry.hostAttr = target.hostAttr;
    entry.snapshot = element.getAttribute("style") ?? "";
  };
  const rememberDecoded = (uris) => {
    if (decodedImages.size >= DECODED_CACHE_LIMIT) {
      decodedImages.clear();
    }
    for (const uri of uris) {
      decodedImages.add(uri);
    }
  };
  const decodeImages = (uris) => {
    const jobs = uris.map((uri) => {
      const image = doc.createElement("img");
      image.src = uri;
      return image.decode();
    });
    return Promise.allSettled(jobs).then(() => {
      rememberDecoded(uris);
    });
  };
  const scheduleApply = (element, entry, target) => {
    if (target !== CLEAR_TARGET && target.key === entry.key) {
      return;
    }
    const pending = target.images.filter((uri) => !decodedImages.has(uri));
    if (target !== CLEAR_TARGET && pending.length > 0) {
      applyNativeSuppressions(element, entry, target);
    }
    if (target === CLEAR_TARGET || pending.length === 0) {
      applyTarget(element, entry, target);
      return;
    }
    entry.seq += 1;
    const seq = entry.seq;
    decodeImages(pending).then(() => {
      const stale = destroyed || entry.seq !== seq || !element.isConnected || !tracked.has(element);
      if (!stale) {
        applyTarget(element, entry, target);
      }
    });
  };
  const handleResize = (element, entry) => {
    if (dirty.has(element) || !entry.source) {
      return;
    }
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (!(width && height)) {
      return;
    }
    scheduleApply(element, entry, computeTarget(entry.source, width, height));
  };
  const collectDirty = () => {
    const dirtyList = [];
    for (const element of dirty) {
      if (element.isConnected) {
        dirtyList.push(element);
      } else {
        untrack(element);
      }
    }
    dirty.clear();
    return dirtyList;
  };
  const readDirtySources = (dirtyList) => {
    if (dirtyList.length === 0) {
      return;
    }
    pendingSheet.setDisabled(true);
    readSheet.setDisabled(false);
    for (const element of dirtyList) {
      const entry = entries.get(element);
      if (entry) {
        removeApplied(element, entry);
      }
    }
    for (const element of dirtyList) {
      const entry = entries.get(element);
      if (entry) {
        entry.source = readSource(element);
      }
    }
    for (const element of dirtyList) {
      const entry = entries.get(element);
      if (entry) {
        restoreApplied(element, entry);
      }
    }
    readSheet.setDisabled(true);
    pendingSheet.setDisabled(false);
  };
  const collectFlushList = (dirtyList) => {
    const flushList = [];
    for (const element of dirtyList) {
      const entry = entries.get(element);
      if (entry && intersectionObserver && !entry.inView) {
        entry.pendingDirty = true;
        continue;
      }
      flushList.push(element);
    }
    return flushList;
  };
  const flush = () => {
    flushScheduled = false;
    if (destroyed) {
      return;
    }
    if (rescanScheduled) {
      rescanScheduled = false;
      rescan();
    }
    const flushList = collectFlushList(collectDirty());
    if (flushList.length === 0) {
      return;
    }
    readDirtySources(flushList);
    for (const element of flushList) {
      const entry = entries.get(element);
      if (!entry) {
        continue;
      }
      if (!entry.source) {
        clearOwned(element, entry);
        entry.snapshot = element.getAttribute("style") ?? "";
        continue;
      }
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (!(width && height)) {
        continue;
      }
      scheduleApply(element, entry, computeTarget(entry.source, width, height));
    }
  };
  const rescan = () => {
    const result = scanDocument(doc);
    const selectors = [...BASE_SELECTORS, ...result.selectors];
    if (options.selector) {
      selectors.push(options.selector);
    }
    selectorString = selectors.filter((selector) => isValidSelector(doc, selector)).join(", ");
    pendingSheet.update(
      buildPendingCss(result.pendingRules, options.pendingRadiusScale)
    );
    pendingSheet.bump();
    trackQueryResults(doc);
    refreshAll();
  };
  const scheduleRescan = () => {
    rescanScheduled = true;
    scheduleFlush();
  };
  const handleChildList = (record) => {
    for (const node of record.addedNodes) {
      if (isStyleNode(node)) {
        scheduleRescan();
      }
      if (node instanceof Element) {
        if (node instanceof HTMLElement && node.matches(selectorString)) {
          track(node);
        }
        trackQueryResults(node);
      }
    }
    for (const node of record.removedNodes) {
      if (isStyleNode(node)) {
        scheduleRescan();
      }
    }
  };
  const handleAttributeMutation = (record) => {
    const element = record.target;
    if (!(element instanceof HTMLElement)) {
      return;
    }
    if (element === doc.documentElement || element === doc.body) {
      refreshAll();
      return;
    }
    if (tracked.has(element)) {
      const entry = entries.get(element);
      if (record.attributeName === "style" && (element.getAttribute("style") ?? "") === entry?.snapshot) {
        return;
      }
      markDirty(element);
    } else if (element.matches(selectorString)) {
      track(element);
    }
    for (const descendant of element.querySelectorAll(selectorString)) {
      if (descendant instanceof HTMLElement && tracked.has(descendant)) {
        markDirty(descendant);
      }
    }
  };
  const mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") {
        handleChildList(record);
      } else {
        handleAttributeMutation(record);
      }
    }
  });
  const handleTransitionLifecycle = (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && tracked.has(target)) {
      markDirty(target);
    }
  };
  const handleFocusChange = (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && tracked.has(target)) {
      markDirty(target);
    }
  };
  const handlePageShow = (event) => {
    if (event.persisted) {
      refreshAll();
    }
  };
  const handleLoad = () => {
    scheduleRescan();
  };
  const colorScheme = doc.defaultView?.matchMedia?.(
    "(prefers-color-scheme: dark)"
  );
  const handleColorScheme = () => {
    refreshAll();
  };
  const start = () => {
    if (destroyed) {
      return;
    }
    rescan();
    mutationObserver.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-corner-shape"]
    });
    doc.addEventListener("transitionrun", handleTransitionLifecycle, true);
    doc.addEventListener("transitionend", handleTransitionLifecycle, true);
    doc.addEventListener("animationend", handleTransitionLifecycle, true);
    doc.addEventListener("focusin", handleFocusChange, true);
    doc.addEventListener("focusout", handleFocusChange, true);
    doc.defaultView?.addEventListener("pageshow", handlePageShow);
    doc.defaultView?.addEventListener("load", handleLoad);
    colorScheme?.addEventListener?.("change", handleColorScheme);
  };
  if (doc.body) {
    start();
  } else {
    doc.addEventListener("DOMContentLoaded", start, { once: true });
  }
  return {
    refresh: () => {
      scheduleRescan();
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      cancelAnimationFrame(rafId);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      doc.removeEventListener("transitionrun", handleTransitionLifecycle, true);
      doc.removeEventListener("transitionend", handleTransitionLifecycle, true);
      doc.removeEventListener("animationend", handleTransitionLifecycle, true);
      doc.removeEventListener("focusin", handleFocusChange, true);
      doc.removeEventListener("focusout", handleFocusChange, true);
      doc.defaultView?.removeEventListener("pageshow", handlePageShow);
      doc.defaultView?.removeEventListener("load", handleLoad);
      colorScheme?.removeEventListener?.("change", handleColorScheme);
      for (const element of tracked) {
        const entry = entries.get(element);
        if (entry) {
          detachHoverListeners(entry);
          clearOwned(element, entry);
        }
      }
      tracked.clear();
      dirty.clear();
      decodedImages.clear();
      pendingSheet.remove();
      baseSheet.remove();
      readSheet.remove();
    }
  };
};

// src/register.ts
var DEFAULT_PENDING_RADIUS_SCALE = 0.6;
var NATIVE_BRIDGE_CSS = `@property ${CORNER_SHAPE_VAR}{syntax:"*";inherits:false;}@supports (corner-shape:squircle){:where(*){corner-shape:var(${CORNER_SHAPE_VAR},round);}}`;
var detectSupport = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("corner-shape", "squircle");
var registerNonInheritedVar = () => {
  try {
    CSS.registerProperty?.({
      name: CORNER_SHAPE_VAR,
      syntax: "*",
      inherits: false
    });
  } catch {
  }
};
var createInertController = (supported) => ({
  supported,
  active: false,
  refresh: () => {
  },
  destroy: () => {
  }
});
var activeController = null;
var registerHyperellipse = (options) => {
  if (activeController) {
    return activeController;
  }
  if (typeof document === "undefined") {
    return createInertController(false);
  }
  const supported = detectSupport();
  if (supported && !options?.force) {
    const bridge = createManagedSheet(document, "bridge");
    bridge.update(NATIVE_BRIDGE_CSS);
    const controller2 = {
      supported,
      active: false,
      refresh: () => {
      },
      destroy: () => {
        bridge.remove();
        activeController = null;
      }
    };
    activeController = controller2;
    return controller2;
  }
  registerNonInheritedVar();
  const engine = createEngine(document, {
    selector: options?.selector,
    pendingRadiusScale: options?.pendingRadiusScale ?? DEFAULT_PENDING_RADIUS_SCALE
  });
  const controller = {
    supported,
    active: true,
    refresh: () => {
      engine.refresh();
    },
    destroy: () => {
      engine.destroy();
      activeController = null;
    }
  };
  activeController = controller;
  return controller;
};

export { registerHyperellipse };
