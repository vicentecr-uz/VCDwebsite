import path from 'node:path';
import sharp from 'sharp';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import tokens from '../../tokens/design-tokens.json';

const WIDTH = 1200;
const HEIGHT = 630;
const INSET = 72;
const TEXT_WIDTH = WIDTH - INSET * 2;
const LOGO_SIZE = 60;
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

function textLayer(text: string, color: string, font: string, height?: number) {
  return sharp({
    text: {
      text: `<span foreground="${color}">${escapeMarkup(text)}</span>`,
      font: `Hanken Grotesk ${font}`,
      fontfile: FONT_FILE,
      width: TEXT_WIDTH,
      height,
      rgba: true,
      wrap: 'word-char',
    },
  }).png().toBuffer({ resolveWithObject: true });
}

export async function renderWriteupShareCard(title: string, publishedOn?: string): Promise<Buffer> {
  const ink = lightColor('on-srf');
  const titleText = title.trim() || 'Untitled';
  const [naturalTitle, date, name, logo] = await Promise.all([
    textLayer(titleText, ink, 'Bold 80'),
    publishedOn && textLayer(dateFormat.format(new Date(publishedOn)), lightColor('on-srf-subtle'), '32'),
    textLayer('Vicente Cruz', ink, 'Medium 52'),
    sharp(LOGO_FILE, { svg: { stylesheet: `polygon, path { fill: ${ink} !important; }` } })
      .resize(LOGO_SIZE, LOGO_SIZE).png().toBuffer(),
  ]);
  // Leave room for metadata and the footer. Scale only titles that exceed the title area.
  const titleImage = naturalTitle.info.height > 310
    ? await textLayer(titleText, ink, 'Bold 80', 310)
    : naturalTitle;
  const layers: sharp.OverlayOptions[] = [
    { input: titleImage.data, left: INSET, top: INSET },
    { input: name.data, left: INSET, top: HEIGHT - INSET - name.info.height },
    { input: logo, left: WIDTH - INSET - LOGO_SIZE, top: HEIGHT - INSET - LOGO_SIZE },
  ];
  if (date) layers.push({ input: date.data, left: INSET, top: INSET + titleImage.info.height + 26 });

  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: lightColor('srf') } })
    .composite(layers).png().toBuffer();
}
