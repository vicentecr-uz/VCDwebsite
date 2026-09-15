import { describe, expect, test } from 'bun:test';
import { resolveVideoAudio } from '../../src/lib/videoAudio';
import { readFileSync } from 'node:fs';

describe('video audio inheritance', () => {
  test('defaults every viewport to authored audio on', () => {
    expect(resolveVideoAudio(undefined)).toEqual({ desktop: true, tablet: true, mobile: true });
  });

  test('inherits each omitted breakpoint from the previous one', () => {
    expect(resolveVideoAudio({ desktop: false, mobile: true })).toEqual({
      desktop: false,
      tablet: false,
      mobile: true,
    });
  });

  test('a scalar off setting applies to every viewport', () => {
    expect(resolveVideoAudio(false)).toEqual({ desktop: false, tablet: false, mobile: false });
  });

  test('production image media targets carry authored audio metadata', () => {
    const image = readFileSync(new URL('../../src/components/project/ProjectImage.astro', import.meta.url), 'utf8');
    expect(image).toContain('data-video-audio={audio !== undefined ? JSON.stringify(audio) : undefined}');
    const controls = readFileSync(new URL('../../src/lib/projectVideoControls.ts', import.meta.url), 'utf8');
    expect(controls).toContain('target?.dataset.devVideoAudio || target?.dataset.videoAudio');
    expect(controls).toContain('data-project-video-audio-off');
  });
});
