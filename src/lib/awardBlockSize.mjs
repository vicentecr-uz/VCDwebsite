const KEYS = ['mobile', 'tablet', 'desktop'];
const MIN_HEIGHT = 32;
const MAX_HEIGHT = 200;

const hasExactKeys = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === KEYS.length
  && KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))
);

export function validateAwardBlockSize(value) {
  if (!hasExactKeys(value) || !KEYS.every((key) => (
    typeof value[key] === 'number'
    && Number.isFinite(value[key])
    && value[key] >= MIN_HEIGHT
    && value[key] <= MAX_HEIGHT
  ))) throw new Error('Invalid award block size configuration.');
  return Object.fromEntries(KEYS.map((key) => [key, value[key]]));
}
