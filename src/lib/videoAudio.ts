import type { ImageViewport } from './responsiveImage';

export type VideoAudioSetting = boolean | Partial<Record<ImageViewport, boolean>>;
export type ResolvedVideoAudio = Record<ImageViewport, boolean>;

const VIEWPORTS: ImageViewport[] = ['desktop', 'tablet', 'mobile'];

export function resolveVideoAudio(setting: VideoAudioSetting | undefined): ResolvedVideoAudio {
  const resolved = {} as ResolvedVideoAudio;
  let inherited = true;
  for (const viewport of VIEWPORTS) {
    const value = typeof setting === 'boolean' ? setting : setting?.[viewport];
    resolved[viewport] = typeof value === 'boolean' ? value : inherited;
    inherited = resolved[viewport];
  }
  return resolved;
}

export function videoAudioStyle(audio: ResolvedVideoAudio): string {
  return VIEWPORTS.map((viewport) => `--project-video-audio-${viewport}:${audio[viewport] ? 1 : 0}`).join(';');
}

export function videoAudioForViewport(audio: ResolvedVideoAudio, viewport: ImageViewport): boolean {
  return audio[viewport];
}
