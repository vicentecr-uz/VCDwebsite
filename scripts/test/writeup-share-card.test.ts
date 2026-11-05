import { expect, test } from 'bun:test';
import { writeupPublicationDate, writeupSocialDescription } from '../../src/lib/writeupShareCard';

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

test('prefers an existing social description and otherwise derives the first prose sentence', () => {
  expect(writeupSocialDescription('Title', [bodyText('Title<br>5 November 2026')], '  A deliberate description.  '))
    .toBe('A deliberate description.');
  expect(writeupSocialDescription('Title', [
    bodyText('Title<br>5 November 2026'),
    { type: 'sectionTitle', text: 'Context' },
    bodyText('- This list item is not a social description.', '<h2>Implementation</h2>', 'The first paragraph explains the change clearly, including why the slower path mattered for readers.'),
  ])).toBe('The first paragraph explains the change clearly, including why the slower path mattered for readers.');
});

test('uses the clean fallback when no suitable sentence is available', () => {
  expect(writeupSocialDescription('Title', [
    bodyText('Title<br>5 November 2026'),
    bodyText('<pre>This is an implementation detail that should never become the social description.</pre>'),
    bodyText('- A short list item.', 'A heading only'),
  ])).toBe('by Vicente Cruz');
});
