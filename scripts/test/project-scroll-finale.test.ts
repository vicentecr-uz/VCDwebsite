import { describe, expect, test } from 'bun:test';
import { shouldUseProjectScrollFinale } from '../../src/lib/projectScrollFinale.ts';

const image = (src = 'image.jpg') => ({ type: 'image', src });

describe('project scroll finale', () => {
  test('does not activate by default, including placeholder images', () => {
    expect(shouldUseProjectScrollFinale(undefined, [image('placeholder.svg'), image('placeholder.svg')])).toBe(false);
  });

  test('activates only when explicitly enabled with two trailing images', () => {
    expect(shouldUseProjectScrollFinale(true, [image(), image()])).toBe(true);
  });

  test('does not activate for an invalid trailing section shape', () => {
    expect(shouldUseProjectScrollFinale(true, [image(), { type: 'placeholder' }])).toBe(false);
    expect(shouldUseProjectScrollFinale(true, [image(), null])).toBe(false);
  });
});
