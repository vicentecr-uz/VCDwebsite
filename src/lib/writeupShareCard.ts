import path from 'node:path';
import sharp from 'sharp';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import tokens from '../../tokens/design-tokens.json';

export const WRITEUP_CARD_WIDTH = 1200;
export const WRITEUP_CARD_HEIGHT = 630;
const INSET = 72;
const TEXT_WIDTH = WRITEUP_CARD_WIDTH - INSET * 2;
const LOGO_SIZE = 60;
const TEXT_BLOCK_HEIGHT = 298;
// Keep a clear strip below the branding for the platform’s title overlay.
const FOOTER_TOP = WRITEUP_CARD_HEIGHT - 158 - LOGO_SIZE;
// Fontconfig loads the bundled font from disk. On macOS, Pango defaults to Core Text.
if (process.platform === 'darwin') process.env.PANGOCAIRO_BACKEND ??= 'fontconfig';

// TrueType copy of the site's Latin WOFF2, covered by public/fonts/hanken-grotesk/OFL.txt.
const FONT_FILE = path.resolve('src/assets/fonts/hanken-grotesk-latin.ttf');
const LOGO_FILE = path.resolve('public/favicon.svg');

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

export function writeupPublicationDate(sections: Array<Record<string, unknown>>): string | undefined {
  const paragraphs = sections.find((section) => section.type === 'bodyText')?.paragraphs;
  if (!Array.isArray(paragraphs)) return;

  const text = (node: DefaultTreeAdapterMap['node']): string => {
    if ('value' in node) return node.value.replace(/\s+/g, ' ');
    if (!('childNodes' in node)) return '';
    if (node.nodeName === 'br') return '\n';
    if (node.nodeName === 'script' || node.nodeName === 'style') return '';
    const children = node.childNodes.map(text).join('');
    return node.nodeName === 'p' || node.nodeName === 'div' ? `\n${children}\n` : children;
  };

  const [, dateLine] = paragraphs.map((html) => text(parseFragment(html))).join('\n')
    .split('\n').map((line) => line.trim()).filter(Boolean);
  if (!dateLine) return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateLine)) return validIsoDate(dateLine);
  const date = /^(\d{1,2}) +([a-z]+) +(\d{4})$/i.exec(dateLine);
  if (!date) return;
  const [, day, month, year] = date;
  const monthIndex = months.indexOf(month.toLowerCase());
  if (monthIndex === -1) return;
  return validIsoDate(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`);
}

function validIsoDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function textLayer(markup: string, font: string, height?: number) {
  return sharp({
    text: {
      text: markup,
      font: `Hanken Grotesk ${font}`,
      fontfile: FONT_FILE,
      width: TEXT_WIDTH,
      height,
      rgba: true,
      spacing: 8,
      wrap: 'word-char',
    },
  }).png().toBuffer({ resolveWithObject: true });
}

export async function renderWriteupShareCard(title: string, publishedOn?: string): Promise<Buffer> {
  const ink = lightColor('on-srf');
  const titleText = title.trim() || 'Untitled';
  const dateText = publishedOn ? dateFormat.format(new Date(publishedOn)) : '';
  const titleDateMarkup = [
    `<span foreground="${ink}">${escapeMarkup(titleText)}</span>`,
    dateText ? `<span foreground="${lightColor('on-srf-subtle')}">${escapeMarkup(dateText)}</span>` : '',
  ].filter(Boolean).join('\n');
  const wordmarkMarkup = `<span foreground="${ink}" letter_spacing="-1400">${escapeMarkup('Vicente Cruz')}</span>`;
  const [naturalTitleDate, name, logo] = await Promise.all([
    textLayer(titleDateMarkup, 'Regular 62'),
    textLayer(wordmarkMarkup, 'Bold 52'),
    sharp(LOGO_FILE, { svg: { stylesheet: `polygon, path { fill: ${ink} !important; }` } })
      .resize(LOGO_SIZE, LOGO_SIZE).png().toBuffer(),
  ]);
  // Keep the title and date at one size, shrinking both together for long titles.
  const titleDateImage = naturalTitleDate.info.height > TEXT_BLOCK_HEIGHT
    ? await textLayer(titleDateMarkup, 'Regular 62', TEXT_BLOCK_HEIGHT)
    : naturalTitleDate;
  const layers: sharp.OverlayOptions[] = [
    { input: titleDateImage.data, left: INSET, top: INSET },
    { input: name.data, left: INSET, top: Math.round(FOOTER_TOP + Math.max(0, (LOGO_SIZE - name.info.height) / 2)) },
    { input: logo, left: WRITEUP_CARD_WIDTH - INSET - LOGO_SIZE, top: FOOTER_TOP },
  ];

  return sharp({ create: { width: WRITEUP_CARD_WIDTH, height: WRITEUP_CARD_HEIGHT, channels: 3, background: lightColor('srf') } })
    .composite(layers).png().toBuffer();
}
