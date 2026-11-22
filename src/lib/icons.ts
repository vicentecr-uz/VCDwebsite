export function sizeIcon(svg: string, size = 14): string {
  return svg
    .replace(/<!--[\s\S]*?-->\s*/, '')
    .replace(/\swidth="24"/, ` width="${size}"`)
    .replace(/\sheight="24"/, ` height="${size}"`)
    .replace('<svg', '<svg aria-hidden="true" focusable="false"')
    .trim();
}
