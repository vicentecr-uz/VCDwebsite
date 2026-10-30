import { describe, expect, test } from 'bun:test';

import { firstProjectSectionImage } from '../../src/lib/projectShareImage';

describe('firstProjectSectionImage', () => {
  test('takes the first image in document order', () => {
    expect(firstProjectSectionImage([
      { type: 'bodyText', paragraphs: ['no image here'] },
      { type: 'image', src: 'Hero.png' },
      { type: 'image', src: 'Later.jpg' },
    ])).toBe('Hero.png');
  });

  test('reaches into nested grid and carousel items', () => {
    expect(firstProjectSectionImage([
      { type: 'sectionTitle', text: 'Process' },
      { type: 'imageGrid', items: [{ src: 'Grid-1.jpeg', alt: 'a' }, { src: 'Grid-2.jpeg' }] },
    ])).toBe('Grid-1.jpeg');
  });

  test('ignores Reddit avatars and press logos — chrome, not the work', () => {
    expect(firstProjectSectionImage([
      { type: 'redditCommentCarousel', comments: [{ avatarSrc: 'reddit/avatars/x.png' }] },
      { type: 'pressQuoteTicker', quotes: [{ logoSrc: 'press-logos/y.png' }] },
      { type: 'image', src: 'Real.png' },
    ])).toBe('Real.png');
  });

  test('skips videos, which have no preview tier', () => {
    expect(firstProjectSectionImage([
      { type: 'video', src: 'demo.mp4' },
      { type: 'image', src: 'Still.png' },
    ])).toBe('Still.png');
  });

  test('skips the placeholder cover', () => {
    expect(firstProjectSectionImage([
      { type: 'image', src: '/images/black-token.svg' },
      { type: 'image', src: 'Real.jpg' },
    ])).toBe('Real.jpg');
  });

  test('returns undefined when a project has no image at all', () => {
    expect(firstProjectSectionImage([{ type: 'bodyText', paragraphs: ['text only'] }]))
      .toBeUndefined();
  });

  test('survives nulls and odd shapes in authored JSON', () => {
    expect(firstProjectSectionImage([
      null as unknown as Record<string, unknown>,
      { type: 'imageGrid', items: null },
      { type: 'image', src: 42 },
      { type: 'image', src: 'Good.png' },
    ])).toBe('Good.png');
  });
});
