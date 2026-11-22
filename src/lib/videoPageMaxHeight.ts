import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Per-viewport vh caps for the application video pages. Saved from the video panel into content, so the
// Save bar publishes them; these defaults apply until a content file exists.
export const VIDEO_PAGE_MAX_HEIGHT_FILE = 'src/content/settings/video-page.json';
const defaults = { desktop: 70, tablet: 75, mobile: 75 };

export type VideoPageMaxHeights = typeof defaults;

export function loadVideoPageMaxHeights(): VideoPageMaxHeights {
  const file = path.join(process.cwd(), VIDEO_PAGE_MAX_HEIGHT_FILE);
  return existsSync(file) ? { ...defaults, ...JSON.parse(readFileSync(file, 'utf8')).maxHeights } : defaults;
}
