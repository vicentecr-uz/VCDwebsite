import { expect, test } from "bun:test";
import { addPadding, findCropBounds } from "../../src/lib/cropBounds";
const image = (
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) d.set(fill(x, y), (y * w + x) * 4);
  return d;
};
test("finds transparent content and fine disconnected lines", () => {
  const d = image(10, 8, () => [0, 0, 0, 0]);
  for (let y = 2; y < 6; y++)
    for (let x = 3; x < 7; x++) d.set([255, 0, 0, 255], (y * 10 + x) * 4);
  d.set([255, 0, 0, 255], (0 * 10 + 9) * 4);
  expect(findCropBounds(d, 10, 8).bounds).toEqual({
    left: 3,
    top: 0,
    right: 9,
    bottom: 5,
  });
});
test("flood fills flat background", () => {
  const d = image(8, 6, (x, y) =>
    x >= 2 && x <= 5 && y >= 1 && y <= 4
      ? [1, 2, 3, 255]
      : [255, 255, 255, 255],
  );
  expect(findCropBounds(d, 8, 6).bounds).toEqual({
    left: 2,
    top: 1,
    right: 5,
    bottom: 4,
  });
});
test("falls back on complex edge", () => {
  const d = image(4, 4, (x, y) => [(x + y) * 50, 0, 0, 255]);
  expect(findCropBounds(d, 4, 4).mode).toBe("full");
});
test("blank transparency is safe", () => {
  const d = image(3, 3, () => [0, 0, 0, 0]);
  expect(findCropBounds(d, 3, 3).bounds).toEqual({
    left: 0,
    top: 0,
    right: 2,
    bottom: 2,
  });
});
test("padding expands by longest edge", () => {
  expect(
    addPadding({ left: 10, top: 10, right: 29, bottom: 19 }, 100, 100, 3),
  ).toEqual({ left: 9, top: 9, right: 30, bottom: 20 });
});
