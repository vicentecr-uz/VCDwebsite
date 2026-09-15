export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface BoundsResult {
  bounds: CropRect;
  mode: "alpha" | "background" | "full";
  confidence: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function addPadding(
  bounds: CropRect,
  width: number,
  height: number,
  percent = 3,
): CropRect {
  const amount =
    (Math.max(0, percent) / 100) *
    Math.max(bounds.right - bounds.left + 1, bounds.bottom - bounds.top + 1);
  return {
    left: Math.floor(clamp(bounds.left - amount, 0, width - 1)),
    top: Math.floor(clamp(bounds.top - amount, 0, height - 1)),
    right: Math.ceil(clamp(bounds.right + amount, 0, width - 1)),
    bottom: Math.ceil(clamp(bounds.bottom + amount, 0, height - 1)),
  };
}

function full(width: number, height: number): CropRect {
  return { left: 0, top: 0, right: width - 1, bottom: height - 1 };
}

export function findCropBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  onProgress?: (value: number) => void,
): BoundsResult {
  if (!width || !height || data.length < width * height * 4)
    return { bounds: full(width, height), mode: "full", confidence: 0 };
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1,
    hasTransparency = false,
    hasVisible = false;
  for (let i = 3; i < width * height * 4; i += 4) {
    if (data[i] < 255) hasTransparency = true;
    if (data[i] > 0) {
      hasVisible = true;
      const p = (i - 3) / 4;
      const x = p % width;
      const y = Math.floor(p / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (i % (width * 40) === 3) onProgress?.((i / (width * height * 4)) * 0.35);
  }
  if (hasTransparency)
    return hasVisible
      ? {
          bounds: { left: minX, top: minY, right: maxX, bottom: maxY },
          mode: "alpha",
          confidence: 1,
        }
      : { bounds: full(width, height), mode: "full", confidence: 1 };
  minX = width;
  minY = height;
  maxX = -1;
  maxY = -1;

  const samples: number[][] = [];
  const step = Math.max(1, Math.floor(Math.max(width, height) / 128));
  for (let x = 0; x < width; x += step)
    for (const y of [0, height - 1])
      samples.push([
        data[(y * width + x) * 4],
        data[(y * width + x) * 4 + 1],
        data[(y * width + x) * 4 + 2],
      ]);
  for (let y = step; y < height - 1; y += step)
    for (const x of [0, width - 1])
      samples.push([
        data[(y * width + x) * 4],
        data[(y * width + x) * 4 + 1],
        data[(y * width + x) * 4 + 2],
      ]);
  const buckets = new Map<string, number>();
  for (const c of samples) {
    const key = c.map((v) => Math.round(v / 16)).join(",");
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const dominant = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = dominant ? dominant[1] / samples.length : 0;
  if (confidence < 0.85)
    return { bounds: full(width, height), mode: "full", confidence };
  const bg = dominant[0]
    .split(",")
    .map(Number)
    .map((v) => v * 16);
  const visited = new Uint8Array(width * height),
    queue = new Uint32Array(width * height);
  let queueLength = 0;
  const near = (p: number) =>
    Math.abs(data[p] - bg[0]) +
      Math.abs(data[p + 1] - bg[1]) +
      Math.abs(data[p + 2] - bg[2]) <=
    36;
  const enqueue = (x: number, y: number) => {
    const i = y * width + x;
    if (!visited[i] && near(i * 4)) {
      visited[i] = 1;
      queue[queueLength++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  for (let head = 0; head < queueLength; head++) {
    const i = queue[head],
      x = i % width,
      y = Math.floor(i / width);
    if (x) enqueue(x - 1, y);
    if (x < width - 1) enqueue(x + 1, y);
    if (y) enqueue(x, y - 1);
    if (y < height - 1) enqueue(x, y + 1);
    if (head % (width * 40) === 0)
      onProgress?.(0.35 + (head / Math.max(1, width * height)) * 0.45);
  }
  for (let i = 0; i < width * height; i++)
    if (!visited[i]) {
      const x = i % width,
        y = Math.floor(i / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return maxX < 0
    ? { bounds: full(width, height), mode: "full", confidence }
    : {
        bounds: { left: minX, top: minY, right: maxX, bottom: maxY },
        mode: "background",
        confidence,
      };
}
