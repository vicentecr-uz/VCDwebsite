import path from 'node:path';
import sharp from 'sharp';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import tokens from '../../tokens/design-tokens.json';

export const WRITEUP_CARD_WIDTH = 1200;
export const WRITEUP_CARD_HEIGHT = 630;
const INSET = 72;
const TEXT_WIDTH = WRITEUP_CARD_WIDTH - INSET * 2;
const TEXT_BLOCK_HEIGHT = 298;
const NAME_BASELINE = 507;
// Fontconfig loads the bundled font from disk. On macOS, Pango defaults to Core Text.
if (process.platform === 'darwin') process.env.PANGOCAIRO_BACKEND ??= 'fontconfig';

// TrueType copy of the site's Latin WOFF2, covered by public/fonts/hanken-grotesk/OFL.txt.
const FONT_FILE = path.resolve('src/assets/fonts/hanken-grotesk-latin.ttf');

function lightColor(role: 'srf' | 'on-srf' | 'on-srf-subtle') {
  const alias = tokens.sys.color[role].$extensions.modes.light;
  const shade = /^\{ref\.palette\.grey\.(\d+)\}$/.exec(alias)?.[1];
  const color = tokens.ref.palette.grey[shade as keyof typeof tokens.ref.palette.grey]?.$value;
  if (!color) throw new Error(`Unresolved light share card color: ${role} (${alias})`);
  return color;
}

const escapeMarkup = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });
const months = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function htmlText(node: DefaultTreeAdapterMap['node'], inlineContext = false): string {
  if ('value' in node) return node.value.replace(/\s+/g, ' ');
  if (!('childNodes' in node)) return '';
  if (node.nodeName === 'br') return '\n';
  if (node.nodeName === 'script' || node.nodeName === 'style' || node.nodeName === 'pre') return '';
  if (/^h[1-6]$/.test(node.nodeName)) return '';
  if (node.nodeName === 'code' && !inlineContext) return '';
  const childInline = inlineContext || node.nodeName === 'p' || node.nodeName === 'div' || node.nodeName === 'li';
  const children = node.childNodes.map((child) => htmlText(child, childInline)).join('');
  if (node.nodeName === 'li') return `\n- ${children}\n`;
  return node.nodeName === 'p' || node.nodeName === 'div' ? `\n${children}\n` : children;
}

function textLines(html: string, proseOnly = false): string[] {
  return htmlText(parseFragment(html), proseOnly).split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function writeupPublicationDate(sections: Array<Record<string, unknown>>): string | undefined {
  const paragraphs = sections.find((section) => section.type === 'bodyText')?.paragraphs;
  if (!Array.isArray(paragraphs)) return;

  const [, dateLine] = paragraphs.flatMap((html) => typeof html === 'string' ? textLines(html) : []);
  if (!dateLine) return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateLine)) return validIsoDate(dateLine);
  const date = /^(\d{1,2}) +([a-z]+) +(\d{4})$/i.exec(dateLine);
  if (!date) return;
  const [, day, month, year] = date;
  const monthIndex = months.indexOf(month.toLowerCase());
  if (monthIndex === -1) return;
  return validIsoDate(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`);
}

const sentenceSegmenter = new Intl.Segmenter('en-GB', { granularity: 'sentence' });
const listPrefix = /^(?:[-*•]\s+|\d+[.)]\s+)/;
const sentenceEnding = /[.!?](?:["'”’»)]*)$/;

export function writeupSocialDescription(
  title: string,
  sections: Array<Record<string, unknown>>,
  description?: string,
): string {
  const existing = description?.trim();
  if (existing) return existing;

  // Use the opening prose as an excerpt. If it yields nothing, prefer the byline to a fragment from deep in the article.
  const opening = sections.filter((section) => section.type === 'bodyText').slice(0, 3);
  const titleLine = title.replace(/\s+/g, ' ').trim();
  for (const { paragraphs } of opening) {
    if (!Array.isArray(paragraphs)) continue;
    for (const paragraph of paragraphs) {
      if (typeof paragraph !== 'string') continue;
      for (const line of textLines(paragraph, true)) {
        if (line === titleLine || listPrefix.test(line)) continue;
        for (const { segment } of sentenceSegmenter.segment(line)) {
          const sentence = segment.trim();
          if (sentence.length >= 40 && sentence.length <= 180 && sentenceEnding.test(sentence)) return sentence;
        }
      }
    }
  }
  return 'by Vicente Cruz';
}

function validIsoDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function textLayer(markup: string, width = TEXT_WIDTH, wrap: 'word' | 'word-char' | 'none' = 'word-char', height?: number) {
  return sharp({
    text: {
      text: markup,
      font: 'Hanken Grotesk Regular 54',
      fontfile: FONT_FILE,
      width,
      height,
      rgba: true,
      spacing: 8,
      wrap,
    },
  }).png().toBuffer({ resolveWithObject: true });
}

async function balancedTextLayer(markup: string) {
  const unwrapped = await textLayer(markup, TEXT_WIDTH, 'none');
  if (unwrapped.info.width <= TEXT_WIDTH && unwrapped.info.height <= TEXT_BLOCK_HEIGHT) return unwrapped;

  const natural = await textLayer(markup);
  if (natural.info.height > TEXT_BLOCK_HEIGHT) {
    return textLayer(markup, TEXT_WIDTH, 'word-char', TEXT_BLOCK_HEIGHT);
  }

  // Narrow the measure without adding a line or splitting a word. The height
  // tolerance allows different letters on the last line, but less than one line.
  let minWidth = Math.ceil(TEXT_WIDTH / 2);
  let maxWidth = TEXT_WIDTH;
  let balanced = natural;
  while (maxWidth - minWidth > 8) {
    const width = Math.floor((minWidth + maxWidth) / 2);
    const candidate = await textLayer(markup, width, 'word');
    if (candidate.info.height <= natural.info.height + 24 && candidate.info.width <= width) {
      balanced = candidate;
      maxWidth = width;
    } else {
      minWidth = width;
    }
  }
  return balanced;
}

export async function renderWriteupShareCard(title: string, publishedOn?: string): Promise<Buffer> {
  const ink = lightColor('on-srf');
  const titleText = title.trim() || 'Untitled';
  const dateText = publishedOn ? dateFormat.format(new Date(publishedOn)) : '';
  const titleDateMarkup = [
    `<span foreground="${ink}">${escapeMarkup(titleText)}</span>`,
    dateText ? `<span foreground="${lightColor('on-srf-subtle')}">${escapeMarkup(dateText)}</span>` : '',
  ].filter(Boolean).join('\n');
  const [titleDate, name] = await Promise.all([
    balancedTextLayer(titleDateMarkup),
    textLayer(`<span foreground="${ink}">Vicente Cruz</span>`),
  ]);

  return sharp({ create: { width: WRITEUP_CARD_WIDTH, height: WRITEUP_CARD_HEIGHT, channels: 3, background: lightColor('srf') } })
    .composite([
      { input: titleDate.data, left: INSET, top: INSET },
      { input: name.data, left: INSET, top: NAME_BASELINE - name.info.height },
    ]).png().toBuffer();
}
