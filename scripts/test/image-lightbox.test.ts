import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  clampImageScale,
  distance,
  midpoint,
  panForPointer,
  panForPinch,
  pinchScale,
  syncLightboxImage,
  IMAGE_LIGHTBOX_MAX_SCALE,
} from '../../src/lib/imageLightbox';

describe('image lightbox geometry', () => {
  test('clamps desktop and pinch zoom to the V0 ceiling', () => {
    expect(clampImageScale(0)).toBe(1);
    expect(clampImageScale(2.5)).toBe(2.5);
    expect(clampImageScale(99)).toBe(IMAGE_LIGHTBOX_MAX_SCALE);
    expect(pinchScale(2, 100, 300)).toBe(IMAGE_LIGHTBOX_MAX_SCALE);
  });

  test('keeps pinch midpoint and single pointer pan calculations deterministic', () => {
    expect(midpoint({ x: 10, y: 30 }, { x: 50, y: 70 })).toEqual({ x: 30, y: 50 });
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(panForPointer({ x: 4, y: -2 }, { x: 10, y: 10 }, { x: 35, y: 25 }))
      .toEqual({ x: 29, y: 13 });
    expect(panForPinch(
      { x: 0, y: 0 },
      { x: 400, y: 300 },
      { x: 450, y: 350 },
      1,
      2,
      { x: 400, y: 300 },
    )).toEqual({ x: 50, y: 50 });
  });

  test('syncs live image eligibility and removes it for placeholders', () => {
    const image = new Window().document.createElement('img');
    image.alt = 'Study';
    syncLightboxImage(image, '/images/study.jpg');
    expect(image.dataset.imageOriginal).toBe('/images/study.jpg');
    expect(image.getAttribute('role')).toBe('button');
    expect(image.tabIndex).toBe(0);
    expect(image.getAttribute('aria-label')).toBe('Open image: Study');
    syncLightboxImage(image, '/images/placeholder.svg');
    expect(image.hasAttribute('data-image-original')).toBe(false);
    expect(image.hasAttribute('role')).toBe(false);
    expect(image.hasAttribute('tabindex')).toBe(false);
  });
});
