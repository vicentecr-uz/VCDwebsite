import { findCropBounds } from "../lib/cropBounds";
self.onmessage = (
  event: MessageEvent<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }>,
) => {
  const { data, width, height } = event.data;
  const result = findCropBounds(data, width, height, (value) =>
    postMessage({ type: "progress", value }),
  );
  postMessage({ type: "progress", value: 1, result });
};
