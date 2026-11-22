import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const VIDEO_PAGE_MAX_HEIGHT_FILE = 'src/content/settings/video-page.json';
const defaults = { desktop: 70, tablet: 75, mobile: 75 };

export type VideoPageMaxHeights = typeof defaults;

export function loadVideoPageMaxHeights(): VideoPageMaxHeights {
  const file = path.join(process.cwd(), VIDEO_PAGE_MAX_HEIGHT_FILE);
  return existsSync(file) ? { ...defaults, ...JSON.parse(readFileSync(file, 'utf8')).maxHeights } : defaults;
}
