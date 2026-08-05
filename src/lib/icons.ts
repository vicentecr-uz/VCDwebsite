/**
 * Resizes a lucide-static icon (authored at 24x24) for the dev UI's compact
 * scale. Lucide's default stroke-width:2 on a 24 viewBox is already close to
 * the hand-drawn dev icons' weight, so shrinking width/height alone (viewBox
 * left untouched) keeps proportions correct without a stroke-width override.
 */
export function sizeIcon(svg: string, size = 14): string {
  return svg
    .replace(/<!--[\s\S]*?-->\s*/, '')
    .replace(/\swidth="24"/, ` width="${size}"`)
    .replace(/\sheight="24"/, ` height="${size}"`)
    .replace('<svg', '<svg aria-hidden="true" focusable="false"')
    .trim();
}
