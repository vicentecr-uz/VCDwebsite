import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { applyCropChange } from '../../astro.config.mjs';
import { mountImageGridSection } from '../../src/scripts/devSectionMount';

test('mounted carousel items render only the recognized Red Dot badge', async () => {
  const window = new Window();
  const previous = new Map([
    ['document', Object.getOwnPropertyDescriptor(globalThis, 'document')],
    ['HTMLElement', Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement')],
  ]);
  Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement });
  try {
    const grid = mountImageGridSection({
      id: 'grid',
      type: 'imageGrid',
      columns: 1,
      items: [{
        id: 'carousel',
        type: 'imageCarousel',
        items: [
          { id: 'badged', src: 'one.jpg', awardBadge: 'red-dot-2026' },
          { id: 'plain', src: 'two.jpg' },
          { id: 'video', src: 'clip.mp4', awardBadge: 'red-dot-2026' },
          { id: 'placeholder', src: 'placeholder.svg', awardBadge: 'red-dot-2026' },
        ],
      }],
    }, 'fixture', 0);
    const badges = [...grid.querySelectorAll<HTMLImageElement>('.project-image-carousel__award-badge')];
    expect(badges).toHaveLength(1);
    expect(badges[0].src).toContain('/awards/red-dot-2026.png');
    expect(badges[0].alt).toBe('Red Dot Award: Product Design 2026');
    expect(badges[0].draggable).toBe(false);
    expect(grid.querySelectorAll('[data-image-original]').length).toBe(2);
  } finally {
    previous.forEach((descriptor, key) => descriptor
      ? Object.defineProperty(globalThis, key, descriptor)
      : Reflect.deleteProperty(globalThis, key));
    await window.happyDOM.close();
  }
});

test('crop changes add and remove a badge without changing media or crop data', () => {
  const data = {
    sections: [{
      type: 'imageCarousel',
      items: [{ id: 'one', src: 'one.jpg', variants: { desktop: { aspect: '4:3', cx: 0.4, cy: 0.6, w: 1.1 } } }],
    }],
  };
  const path = ['sections', 0, 'items', 0];
  const add = applyCropChange(data, { path, awardBadge: 'red-dot-2026' });
  expect(add).toEqual({ ok: true });
  expect(data.sections[0].items[0]).toMatchObject({
    src: 'one.jpg',
    awardBadge: 'red-dot-2026',
    variants: { desktop: { aspect: '4:3', cx: 0.4, cy: 0.6, w: 1.1 } },
  });

  const remove = applyCropChange(data, { path, awardBadge: '' });
  expect(remove).toEqual({ ok: true });
  expect(data.sections[0].items[0].awardBadge).toBeUndefined();

  const before = structuredClone(data);
  const invalid = applyCropChange(data, { path, awardBadge: 'other-award' });
  expect(invalid.ok).toBe(false);
  expect(data).toEqual(before);

  const videoData = { sections: [{ type: 'imageCarousel', items: [{ id: 'video', src: 'clip.mp4' }] }] };
  expect(applyCropChange(videoData, { path, awardBadge: 'red-dot-2026' }).ok).toBe(false);
  expect(videoData.sections[0].items[0].awardBadge).toBeUndefined();
  const placeholderData = { sections: [{ type: 'imageCarousel', items: [{ id: 'placeholder', src: 'placeholder.svg' }] }] };
  expect(applyCropChange(placeholderData, { path, awardBadge: 'red-dot-2026' }).ok).toBe(false);
  expect(placeholderData.sections[0].items[0].awardBadge).toBeUndefined();

  const reordered = {
    sections: [{ id: 'carousel', type: 'imageCarousel', items: [
      { id: 'badged', src: 'one.jpg' }, { id: 'other', src: 'two.jpg' },
    ] }],
  };
  (reordered.sections[0].items as any[]).reverse();
  expect(applyCropChange(reordered, {
    path: ['sections', 0, 'items', 0],
    target: { sectionId: 'carousel', itemId: 'badged' },
    awardBadge: 'red-dot-2026',
  })).toEqual({ ok: true });
  expect(reordered.sections[0].items[1].awardBadge).toBe('red-dot-2026');
  expect(reordered.sections[0].items[0].awardBadge).toBeUndefined();
});
