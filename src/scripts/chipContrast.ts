export type Rgba = { r: number; g: number; b: number; a: number };

const clamp = (value: number) => Math.min(255, Math.max(0, value));

function luminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) => {
    const value = clamp(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const aLuminance = luminance(a);
  const bLuminance = luminance(b);
  const lighter = Math.max(aLuminance, bLuminance);
  const darker = Math.min(aLuminance, bLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = Math.min(1, Math.max(0, top.a));
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: alpha + bottom.a * (1 - alpha),
  };
}

function meetsContrast(
  pixels: Uint8ClampedArray,
  ink: Rgba,
  fillColor: 0 | 255,
  opacity: number,
  brightness: readonly number[],
): boolean {
  for (let index = 0; index + 2 < pixels.length; index += 4) {
    for (const factor of brightness) {
      const background: Rgba = {
        r: clamp(pixels[index] * factor),
        g: clamp(pixels[index + 1] * factor),
        b: clamp(pixels[index + 2] * factor),
        a: 1,
      };
      const filled = composite({ r: fillColor, g: fillColor, b: fillColor, a: opacity }, background);
      if (contrast(composite(ink, filled), filled) < 4.5) return false;
    }
  }
  return true;
}

export function chipContrastFill(
  pixels: Uint8ClampedArray,
  ink: Rgba,
  brightness: readonly number[],
): { color: 0 | 255; opacity: number } {
  const color: 0 | 255 = luminance(ink) < 0.5 ? 255 : 0;
  if (pixels.length < 3 || brightness.length === 0) return { color, opacity: 0 };

  if (meetsContrast(pixels, ink, color, 0, brightness)) return { color, opacity: 0 };
  // Opacity 1 is the ceiling for unsupported low-contrast custom tokens; use stronger ink to improve it.
  if (!meetsContrast(pixels, ink, color, 1, brightness)) return { color, opacity: 1 };

  let low = 0;
  let high = 1;
  for (let step = 0; step < 10; step += 1) {
    const middle = (low + high) / 2;
    if (meetsContrast(pixels, ink, color, middle, brightness)) high = middle;
    else low = middle;
  }
  return { color, opacity: Math.min(1, Math.ceil(high * 1000) / 1000) };
}
