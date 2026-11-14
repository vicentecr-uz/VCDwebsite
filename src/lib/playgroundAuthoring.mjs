import { createContentHandlers, applyCropChangeFromSource } from './contentAuthoring.mjs';
import { normalizeAssetSrc, stripAssetRefsFromDocument, validateProjectOutline, validateProjectOutlineTargets } from './contentAuthoringMedia.mjs';
import { normalizeOutline } from './projectOutline.ts';
import { DEFAULT_IMAGE_VARIANTS, PLACEHOLDER_IMAGE_VARIANTS } from './projectImageDefaults.ts';
import { validateSiteAnnotations } from './siteAnnotations.ts';
import { isAcceptedImageFile, isAcceptedVideoFile } from './imageUpload.mjs';
import { validateAwardBlockSize } from './awardBlockSize.mjs';

const defaultImage = () => structuredClone(DEFAULT_IMAGE_VARIANTS);
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const sameContent = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameContent(a[key], b[key]));
};

function mediaNodes(sections) {
  const rows = [];
  const visit = (node, path) => {
    if (typeof node.src === 'string' && node.src && node.src !== 'placeholder.svg') rows.push({ node, path });
    node.items?.forEach((item, index) => visit(item, [...path, 'items', index]));
  };
  sections.forEach((section, index) => visit(section, ['sections', index]));
  return rows;
}

export function createPlaygroundAuthoring({
  seed, catalog, readMediaDimensions, upload, discardUpload = () => {},
  readDraft, writeDraft, savedAssets = [], deletedSources = [],
}) {
  const slug = seed.slug;
  let project = readDraft() ?? structuredClone(seed);
  let deletedAssets = new Set(deletedSources);
  let uploads = new Map(savedAssets.map((file) => [file.src, file]));
  const library = new Map();
  const sourceProject = 'new-classic-utility-knife';
  const libraryProjects = catalog.map(({ slug: key, title }) => ({ slug: key === sourceProject ? slug : key, title }));
  if (!libraryProjects.some((row) => row.slug === slug)) libraryProjects.unshift({ slug, title: seed.title });
  for (const group of catalog) {
    for (const asset of group.images) {
      const row = library.get(asset.src) ?? { ...asset, id: asset.src, usedBy: [] };
      if (group.slug !== sourceProject) row.usedBy.push(group.slug);
      library.set(asset.src, row);
    }
  }
  for (const { node } of mediaNodes(seed.sections)) {
    if (!library.has(node.src)) {
      const url = `/images/${node.src.split('/').map(encodeURIComponent).join('/')}`;
      library.set(node.src, { src: node.src, id: node.src, filename: node.src.split('/').at(-1), url, usedBy: [] });
    }
  }

  const assertDocument = (key) => {
    if (key !== slug) throw new Error('Only the playground project can be edited here.');
    return key;
  };
  const persist = (data, media = uploads, deleted = deletedAssets) =>
    writeDraft(data, { uploads: [...media.values()], deleted: [...deleted] });
  const save = async (_key, data) => {
    await persist(data);
    project = structuredClone(data);
  };
  const readDims = async (src) => {
    const token = normalizeAssetSrc(src);
    if (deletedAssets.has(token)) return null;
    const dimensions = uploads.get(token)?.dimensions;
    if (dimensions) return dimensions;
    if (!library.has(token)) return null;
    const match = mediaNodes(seed.sections).find(({ node }) => node.src === token)?.node;
    if (match?.srcWidth && match?.srcHeight) return { srcWidth: match.srcWidth, srcHeight: match.srcHeight };
    return readMediaDimensions(library.get(token).url);
  };
  const mediaItems = (sources) => Promise.all(sources.map(async (value) => {
    const src = normalizeAssetSrc(value);
    const dimensions = await readDims(src);
    if (!dimensions) throw new Error('Could not read that image or video.');
    return { id: id('item'), src, alt: '', ...dimensions, variants: defaultImage() };
  }));
  const buildImage = async (sources) => {
    const [item] = await mediaItems(sources.slice(0, 1));
    return { ...item, id: id('image'), type: 'image', spacing: 'group' };
  };
  const buildGrid = async (sources) => {
    const items = await mediaItems(sources);
    const visible = items.map((item) => item.id);
    return {
      type: 'imageGrid', id: id('grid'), columns: Math.min(2, items.length), defaultAspectRatio: '4:3', spacing: 'group', items,
      layouts: { desktop: { visible }, mobile: { visible: [...visible] } },
    };
  };
  const buildCarousel = async (sources) => {
    const items = await mediaItems(sources);
    return {
      type: 'imageCarousel', id: id('carousel'), orientation: 'horizontal', heightMode: 'dynamic', dotsPlacement: 'outside',
      defaultAspectRatio: 'original', spacing: 'group', items, visible: items.map((item) => item.id),
    };
  };

  const handlers = createContentHandlers({
    readDocument: (key) => {
      assertDocument(key);
      return structuredClone(project);
    },
    writeDocument: save,
    resolveDocument: (key) => key === slug ? key : undefined,
    resolveFieldTarget: (key, _view, path) => key === slug && Array.isArray(path) && path.length ? { relativeFile: key, path } : null,
    readMediaDimensions: readDims,
    buildImageSection: (_key, files) => buildImage(files), buildImageSectionFromSrcs: buildImage,
    buildImageGridSection: (_key, files) => buildGrid(files), buildImageGridSectionFromSrcs: buildGrid,
    buildImageCarouselSection: (_key, files) => buildCarousel(files), buildImageCarouselSectionFromSrcs: buildCarousel,
    async fillPlaceholderImageSection(section, _key, filename, variants, existingSrc) {
      if (section?.src !== 'placeholder.svg') throw new Error('That image is no longer a placeholder.');
      const [item] = await mediaItems([existingSrc || filename]);
      const { id: _id, variants: _variants, ...source } = item;
      Object.assign(section, source, { type: 'image' });
      section.variants = variants ?? section.variants ?? structuredClone(PLACEHOLDER_IMAGE_VARIANTS);
    },
    sameSection: sameContent,
  });

  const assets = () => {
    const onPage = new Set(mediaNodes(project.sections).map(({ node }) => node.src));
    const localAssets = [...uploads.values()].map(({ src, filename, url }) => ({
      src, filename, url, id: src, usedBy: [],
    }));
    const list = [...library.values(), ...localAssets].filter((row) => !deletedAssets.has(row.src))
      .map((row) => ({ ...row, usedBy: onPage.has(row.src) ? [...row.usedBy, slug] : row.usedBy }));
    return { assets: list, projects: [...libraryProjects, { slug: '__unassigned__', title: 'Unassigned' }] };
  };
  const descriptions = () => mediaNodes(project.sections).map(({ node, path }) => ({
    key: JSON.stringify(path), document: slug, title: project.title, path, pathLabel: String(node.id ?? 'Image'),
    src: node.src, alt: String(node.alt ?? ''), description: String(node.alt ?? ''), intent: 'manual', status: 'Browser copy',
    baseToken: JSON.stringify([node.id, node.src, node.alt]),
  }));

  async function handle(method, endpoint, body, send) {
    if (method === 'GET') {
      if (endpoint === 'assets') return send(200, assets());
      if (endpoint === 'image-descriptions') return send(200, { rows: descriptions(), checking: false });
      if (endpoint === 'publish') return send(200, { readOnly: true, branch: 'Browser copy', files: [] });
      if (endpoint === 'commit-engine') return send(200, { readOnly: true, files: [] });
      if (endpoint === 'dev-branch-update') return send(200, { available: false, branch: 'Browser copy', revision: 'playground', clean: true });
    }
    if (method === 'DELETE' && endpoint === 'assets') {
      if (!library.has(body.src) && !uploads.has(body.src)) return send(404, { error: 'That asset no longer exists.' });
      const removed = new Set([...deletedAssets, body.src]);
      const edited = structuredClone(project);
      const stripped = stripAssetRefsFromDocument(edited, body.src);
      await persist(edited, uploads, removed);
      project = edited;
      deletedAssets = removed;
      return send(200, { ok: true, src: body.src, stripped });
    }
    if (method !== 'POST') return send(405, { error: 'That operation is unavailable in the playground.' });
    if (Object.hasOwn(handlers, endpoint)) return handlers[endpoint](body, send);
    if (endpoint === 'content-revert') {
      await reset();
      return send(200, { ok: true });
    }
    if (endpoint === 'image-descriptions') return send(200, { rows: descriptions(), checking: false });
    if (endpoint === 'image-description-save') {
      const row = descriptions().find(({ key }) => key === body.key);
      if (!row || row.baseToken !== body.baseToken) return send(409, { error: 'That image changed. Refresh and try again.' });
      const data = structuredClone(project);
      const node = row.path.reduce((value, key) => value[key], data);
      node.alt = String(body.alt ?? '').slice(0, 300);
      node.altIntent = 'manual';
      await save(slug, data);
      return send(200, { ok: true, row: descriptions().find(({ key }) => key === body.key) });
    }
    if (endpoint === 'upload') {
      assertDocument(body.document);
      if (!Array.isArray(body.files) || !body.files.length) return send(400, { error: 'Choose at least one file.' });
      for (const { filename, mimeType, data } of body.files) {
        if (typeof data !== 'string' || !data || (!isAcceptedImageFile({ name: filename, type: mimeType })
          && !isAcceptedVideoFile({ name: filename, type: mimeType }))) {
          return send(400, { error: 'Choose a supported image or video.' });
        }
      }
      const staged = [];
      const media = new Map(uploads);
      try {
        for (const payload of body.files) {
          const file = await upload(payload);
          staged.push(file);
          media.set(file.src, file);
        }
        await persist(project, media);
        uploads = media;
      } catch (error) {
        staged.forEach(discardUpload);
        throw error;
      }
      return send(200, { ok: true, filenames: staged.map((file) => file.src) });
    }

    const data = structuredClone(project);
    if (endpoint === 'award-block-size') {
      data.awardBlockSize = validateAwardBlockSize(body);
      await save(slug, data);
      return send(200, { ok: true, path: 'in browser' });
    }
    if (endpoint === 'content-section-order') {
      assertDocument(body.document);
      const order = body.orderIds ?? body.order;
      if (!Array.isArray(order) || order.length !== data.sections.length || new Set(order).size !== order.length) {
        return send(400, { error: 'Section order does not match the document.' });
      }
      const reordered = order.map((value) => body.orderIds
        ? data.sections.find((section) => section.id === value) : data.sections[Number(value)]);
      if (reordered.some((section) => !section) || new Set(reordered).size !== reordered.length) {
        return send(400, { error: 'Invalid section order.' });
      }
      if (body.outline !== undefined) {
        if (!validateProjectOutline(body.outline) || !validateProjectOutlineTargets(body.outline, data.sections)) {
          return send(400, { error: 'The section outline is invalid.' });
        }
        data.outline = normalizeOutline(body.outline);
      }
      data.sections = reordered;
      await save(slug, data);
      return send(200, { ok: true, outline: data.outline });
    }
    if (endpoint === 'content-annotations') {
      assertDocument(body.document);
      const section = data.sections.find((entry) => entry.id === body.sectionId);
      if (!section || !sameContent(section.annotations ?? [], body.expected)) return send(409, { error: 'The drawing has changed.' });
      if (!validateSiteAnnotations(body.annotations, new Set([section.id]))) return send(400, { error: 'Invalid drawing.' });
      section.annotations = body.annotations;
      await save(slug, data);
      return send(200, { ok: true });
    }
    if (endpoint === 'image-crop') {
      assertDocument(body.document);
      const result = await applyCropChangeFromSource(data, body, readDims);
      if (!result.ok) return send(400, result);
      await save(slug, data);
      return send(200, { ok: true });
    }
    return send(403, { error: 'This operation requires the owner checkout.' });
  }

  async function reset() {
    await writeDraft(null);
    project = structuredClone(seed);
    deletedAssets.clear();
    uploads.forEach(discardUpload);
    uploads.clear();
  }
  return { handle, reset, snapshot: () => structuredClone(project) };
}
