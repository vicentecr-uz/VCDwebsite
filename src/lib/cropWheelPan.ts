const BASE_FRAME_MS = 1000 / 60;
const SPEED_ALPHA = 0.32;
const GAIN_KNEE = 40;
const PAN_GAIN_FINE = 0.38;
const PAN_GAIN_FAST = 1;

export interface CropWheelPanGain {
  gainFor(dx: number, dy: number, timeStamp: number): number;
  reset(): void;
}

export const createCropWheelPanGain = (idleMs = 160): CropWheelPanGain => {
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
      const t = Math.min(1, Math.max(0, speed) / GAIN_KNEE);
      const blend = t * t * (3 - 2 * t);
      return PAN_GAIN_FINE + (PAN_GAIN_FAST - PAN_GAIN_FINE) * blend;
    },
    reset() {
      speed = 0;
      lastTime = undefined;
    },
  };
};
