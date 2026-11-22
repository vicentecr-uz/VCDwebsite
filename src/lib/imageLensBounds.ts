interface LensBoundsInput {
  width: number;
  height: number;
  diameter: number;
  depth: number;
  edgeWidth: number;
  refraction: number;
  zoom: number;
  gap: number;
}

export function imageLensBounds({ width, height, diameter, depth, edgeWidth, refraction, zoom, gap }: LensBoundsInput) {
  const radius = diameter / 2;
  const padding = Math.ceil(depth * 2 * refraction * Math.sqrt(1.25) + 12);
  const reversal = Math.max(0, depth * 2 * refraction * Math.sqrt(1.25) - Math.max(0, radius - edgeWidth - 1));
  const footprint = (Math.max(radius, reversal) + 1) / zoom;
  const reach = Math.max(1, Math.min(diameter * 0.16, (gap - 4) * 0.3));
  const boundaryRadius = Math.max(0, footprint + reach - gap + 4);
  return {
    padding, reach, boundaryRadius, footprint,
    min: boundaryRadius - radius,
    x: width - radius - boundaryRadius,
    y: height - radius - boundaryRadius,
  };
}
