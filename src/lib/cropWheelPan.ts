const BASE_FRAME_MS = 1000 / 60;
const SPEED_ALPHA = 0.32;
const PAN_GAIN_FINE = 0.38;
const PAN_GAIN_FAST = 1;

export interface CropWheelPanGain {
  gainFor(dx: number, dy: number, timeStamp: number): number;
  reset(): void;
}

const createGain = (fine: number, fast: number, offset: number, range: number, idleMs: number): CropWheelPanGain => {
  let speed = 0;
  let lastTime: number | undefined;
  return {
    gainFor(dx, dy, timeStamp) {
      const elapsed = lastTime !== undefined && Number.isFinite(timeStamp) && Number.isFinite(lastTime)
        ? timeStamp - lastTime
        : Number.NaN;
      const newSession = elapsed > idleMs;
      if (newSession) speed = 0;
      const dt = lastTime === undefined || !Number.isFinite(timeStamp) || !Number.isFinite(lastTime) || elapsed <= 0 || newSession
        ? BASE_FRAME_MS
        : elapsed;
      lastTime = timeStamp;
      const magnitude = Math.hypot(dx, dy) * BASE_FRAME_MS / dt;
      const alpha = 1 - Math.pow(1 - SPEED_ALPHA, dt / BASE_FRAME_MS);
      speed += (magnitude - speed) * alpha;
      const t = Math.min(1, Math.max(0, (speed - offset) / range));
      const blend = t * t * (3 - 2 * t);
      return fine + (fast - fine) * blend;
    },
    reset() {
      speed = 0;
      lastTime = undefined;
    },
  };
};

export const createCropWheelPanGain = (idleMs = 160): CropWheelPanGain => createGain(PAN_GAIN_FINE, PAN_GAIN_FAST, 0, 40, idleMs);
export const createCropWheelZoomGain = (idleMs = 160): CropWheelPanGain => createGain(0.00085, 0.0044, 2, 14, idleMs);
