import { expect, test } from 'bun:test';
import { writeupPublicationDate } from '../../src/lib/writeupShareCard';

const bodyText = (...paragraphs: string[]) => ({ type: 'bodyText', paragraphs });

test('reads the date below the title in the first text block', () => {
  expect(writeupPublicationDate([
    { type: 'image' },
    bodyText('Title<br><span class="text-subtle">5&nbsp;November 2026</span>'),
  ])).toBe('2026-11-05');
  expect(writeupPublicationDate([bodyText('<strong>Title</strong>', '29 February 2024')])).toBe('2024-02-29');
  expect(writeupPublicationDate([bodyText('<div>Title</div><div>2026-11-05</div>')])).toBe('2026-11-05');
});

test('ignores prose, invalid calendar dates and dates in later blocks', () => {
  expect(writeupPublicationDate([bodyText('Title', 'Written in November 2026')])).toBeUndefined();
  expect(writeupPublicationDate([bodyText('Title<br>29 February 2026')])).toBeUndefined();
  expect(writeupPublicationDate([bodyText('Title'), bodyText('Another heading<br>5 November 2026')])).toBeUndefined();
});
