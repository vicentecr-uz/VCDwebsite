import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const VIDEO_PAGE_MAX_HEIGHT_FILE = 'src/content/settings/video-page.json';
const defaults = { desktop: 70, tablet: 75, mobile: 75 };
const footnoteDefaults = {
  note: '',
  old: { lead: 'You can see the old one', link: 'here' },
  new: { lead: 'See the', link: 'new video' },
};

export type VideoPageMaxHeights = typeof defaults;
export type VideoPageFootnote = typeof footnoteDefaults;

function readVideoPage() {
  const file = path.join(process.cwd(), VIDEO_PAGE_MAX_HEIGHT_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

export function loadVideoPageMaxHeights(): VideoPageMaxHeights {
  return { ...defaults, ...readVideoPage().maxHeights };
}

export function loadVideoPageFootnote(): VideoPageFootnote | undefined {
  const footnote = readVideoPage().footnote;
  return footnote && { ...footnoteDefaults, ...footnote };
}
