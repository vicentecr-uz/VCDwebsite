import { z } from 'astro/zod';
import { craftDemo } from './craftDemos';

export const CONTENT_SCHEMA_VERSION = 1;
const text = z.string();
const number = z.number();
const object = z.object({}).passthrough();
const strings = z.array(text);
const responsive = <T extends z.ZodType>(value: T) => z.union([value, z.record(text, value)]);
const version = z.literal(CONTENT_SCHEMA_VERSION).optional();
const image = object.extend({ src: text, alt: text.optional(), srcWidth: number.optional(), srcHeight: number.optional() });
const images = z.array(image);
const carousel = object.extend({ type: z.literal('imageCarousel'), items: images });
const gridItems = z.array(z.union([image, carousel]));
const sectionBase = object.extend({
  type: text,
  id: text.optional(),
  sectionId: text.optional(),
  spacing: responsive(text).optional(),
  srcWidth: number.optional(),
  srcHeight: number.optional(),
  maxVh: number.optional(),
  maxHeightVh: number.optional(),
  constrained: responsive(z.union([number, z.boolean(), z.literal('text')])).optional(),
  variants: object.optional(),
  captions: responsive(text).optional(),
  showTitle: responsive(z.boolean()).optional(),
  intro: z.boolean().optional(),
  balance: z.boolean().optional(),
  mobileInset: z.boolean().optional(),
  scrollPinned: z.boolean().optional(),
  matchHeight: z.boolean().optional(),
});
const imageFields = { src: text, alt: text.optional() };
const shared = {
  heroImage: imageFields,
  image: imageFields,
  imageGrid: { items: gridItems, columns: responsive(number).optional() },
  bodyText: { paragraphs: strings },
  sectionTitle: { title: text, level: number.optional() },
  video: { src: text, title: text.optional() },
};
const modern: Record<string, z.ZodRawShape> = {
  ...shared,
  imageCarousel: { items: images, visible: strings.optional() },
  interactiveDemo: { demo: text.refine((id) => Boolean(craftDemo(id)), 'unsupported craft demo'), sample: object.optional() },
  signup: { label: text.optional(), placeholder: text.optional() },
  award: { src: text.optional(), href: text.optional(), alt: text.optional() },
  projectDetails: { rows: z.array(object.extend({ label: text, value: text })) },
  pressQuoteTicker: { items: z.array(object.extend({ quote: text, logoSrc: text, logoAlt: text, href: text })) },
  redditCommentCarousel: { items: z.array(object.extend({ author: text, paragraphs: strings, score: z.union([number, text]) })) },
  placeholder: { label: text.optional() },
  projectGrid: { variant: z.enum(['home', 'play']).optional() },
};
const legacy: Record<string, z.ZodRawShape> = {
  ...shared,
  tagline: { text: text.optional(), prefix: text.optional(), linkLabel: text.optional(), linkHref: text.optional() },
  prose: { paragraphs: strings, heading: text.optional() },
  mediaGrid: { items: z.array(image.extend({ style: z.enum(['caption', 'detail', 'cell']) })) },
  constrainedCaptionImage: { ...imageFields, caption: text.optional() },
  systemGrid: { items: images },
  researchGrid: { columns: z.array(images) },
  tripleGrid: { items: images },
  detailGrid: { items: images },
  referenceGrid: { items: images },
  processGrid: { items: images },
  moodboard: { items: images },
  captionedImage: { ...imageFields, caption: text.optional() },
  hoverSwap: { baseSrc: text, baseAlt: text.optional(), topSrc: text, topAlt: text.optional() },
  contextGrid: { items: images },
  layoutSplit: { leftSrc: text, leftAlt: text.optional(), items: images },
  sketchModels: { setupSrc: text, setupAlt: text.optional(), items: images },
  finalHero: imageFields,
};
const sectionSchemas = Object.fromEntries(Object.entries({ modern, legacy }).map(([stack, types]) => [
  stack, Object.fromEntries(Object.entries(types).map(([type, fields]) => [type, sectionBase.extend(fields)])),
])) as Record<'modern' | 'legacy', Record<string, z.ZodType>>;
const document = object.extend({
  schemaVersion: version,
  title: text.optional(),
  description: text.optional(),
  sections: z.array(sectionBase),
  outline: z.array(object).optional(),
  introHeight: number.optional(),
  trailingSpacing: responsive(text).optional(),
});
const listing = object.extend({ image: text, bg: text, dark: z.boolean() });
const projectSchema = document.extend({
  title: text,
  slug: text.optional(),
  stack: z.enum(['modern', 'legacy']).optional(),
  status: z.enum(['published', 'draft', 'teaser', 'image']).optional(),
  listings: z.record(text, listing).optional(),
  scrollFinale: z.boolean().optional(),
});
const headerSchema = object.extend({
  schemaVersion: version,
  siteTitle: text,
  logoPath: text,
  menuLinks: z.array(object.extend({ label: text, href: text })),
});

function validate<T>(schema: z.ZodType<T>, input: unknown, file: string, prefix = ''): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.reduce<string>((path, key) => typeof key === 'number'
      ? `${path}[${key}]` : `${path}${path ? '.' : ''}${String(key)}`, prefix);
    throw new Error(`${file}: ${field || '$'}: ${issue.message}`);
  }
  return result.data;
}

function validateSections(sections: Array<z.infer<typeof sectionBase>>, stack: 'modern' | 'legacy', file: string): void {
  sections.forEach((section, index) => {
    const schema = Object.hasOwn(sectionSchemas[stack], section.type) ? sectionSchemas[stack][section.type] : undefined;
    if (!schema) throw new Error(`${file}: sections[${index}].type: unsupported ${stack} section type "${section.type}"`);
    validate(schema, section, file, `sections[${index}]`);
  });
}

export function validateProjectDocument(input: unknown, file = 'project document') {
  const project = validate(projectSchema, input, file);
  validateSections(project.sections, project.stack ?? 'modern', file);
  return project;
}

export function validatePageDocument(input: unknown, file = 'page document') {
  const page = validate(document, input, file);
  validateSections(page.sections, 'modern', file);
  return page;
}

export function validateHeaderSettings(input: unknown, file = 'header settings') {
  return validate(headerSchema, input, file);
}

export function validateContentVersion(input: unknown, file = 'content schema') {
  // Missing marker is legacy v1 during expand/migrate; require it after the content migration and cutover.
  if (input === undefined) return { schemaVersion: CONTENT_SCHEMA_VERSION };
  return validate(object.extend({ schemaVersion: z.literal(CONTENT_SCHEMA_VERSION) }), input, file);
}
