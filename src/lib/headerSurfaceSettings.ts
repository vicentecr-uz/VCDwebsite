export type HeaderSurfaceProfile = 'desktop' | 'mobile';

export type HeaderSurfaceField =
  | 'radius'
  | 'feather'
  | 'sidePadding'
  | 'bottomPadding'
  | 'backdropOpacity';

export type HeaderSurfaceProfileSettings = Record<HeaderSurfaceField, number>;

export type HeaderSurfaceSettings = Record<HeaderSurfaceProfile, HeaderSurfaceProfileSettings>;

export const HEADER_SURFACE_STORAGE_KEY = 'vcd:header-surface:v1';

export const HEADER_SURFACE_DEFAULTS: HeaderSurfaceSettings = {
  desktop: { radius: 3.5, feather: 4, sidePadding: 3.5, bottomPadding: 1, backdropOpacity: 90 },
  mobile: { radius: 2.5, feather: 3, sidePadding: 2.5, bottomPadding: 0.75, backdropOpacity: 90 },
};

export const HEADER_SURFACE_FIELDS: Array<{
  key: HeaderSurfaceField;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  { key: 'radius', label: 'Corner radius', min: 0, max: 6, step: 0.05, unit: 'em' },
  { key: 'feather', label: 'Feather width', min: 0.25, max: 10, step: 0.05, unit: 'em' },
  { key: 'sidePadding', label: 'Side padding', min: 0, max: 8, step: 0.05, unit: 'em' },
  { key: 'bottomPadding', label: 'Bottom padding', min: 0, max: 8, step: 0.05, unit: 'em' },
  { key: 'backdropOpacity', label: 'Backdrop opacity', min: 0, max: 100, step: 1, unit: '%' },
];

const isProfile = (value: unknown): value is HeaderSurfaceProfile => value === 'desktop' || value === 'mobile';

const fieldDefinition = (key: HeaderSurfaceField) => HEADER_SURFACE_FIELDS.find((field) => field.key === key)!;

export const normalizeHeaderSurfaceValue = (key: HeaderSurfaceField, value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const { min, max, step } = fieldDefinition(key);
  const clamped = Math.min(max, Math.max(min, value));
  const stepped = min + Math.round((clamped - min) / step) * step;
  return Number(stepped.toFixed(6));
};

export const normalizeHeaderSurfaceSettings = (input: unknown): HeaderSurfaceSettings => {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return (['desktop', 'mobile'] as const).reduce((settings, profile) => {
    const profileSource = source[profile] && typeof source[profile] === 'object' && !Array.isArray(source[profile])
      ? source[profile] as Record<string, unknown>
      : {};
    settings[profile] = HEADER_SURFACE_FIELDS.reduce((values, field) => {
      values[field.key] = normalizeHeaderSurfaceValue(
        field.key,
        profileSource[field.key],
        HEADER_SURFACE_DEFAULTS[profile][field.key],
      );
      return values;
    }, {} as HeaderSurfaceProfileSettings);
    return settings;
  }, {} as HeaderSurfaceSettings);
};

export const cssVariablesForProfile = (
  profile: HeaderSurfaceProfile,
  settings: HeaderSurfaceProfileSettings,
): Record<string, string> => {
  const prefix = profile === 'mobile' ? '--header-surface-mobile-' : '--header-surface-';
  return {
    [`${prefix}radius`]: `${settings.radius}em`,
    [`${prefix}feather`]: `${settings.feather}em`,
    [`${prefix}side-padding`]: `${settings.sidePadding}em`,
    [`${prefix}bottom-padding`]: `${settings.bottomPadding}em`,
    [`${prefix}backdrop-opacity`]: `${settings.backdropOpacity}%`,
  };
};

export const cssVariablesForSettings = (settings: HeaderSurfaceSettings) => ({
  ...cssVariablesForProfile('desktop', settings.desktop),
  ...cssVariablesForProfile('mobile', settings.mobile),
});

export const isHeaderSurfaceProfile = isProfile;
