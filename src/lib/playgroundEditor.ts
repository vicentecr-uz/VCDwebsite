import { createPlaygroundAuthoring } from './playgroundAuthoring.mjs';
import { mountInsertedSection, initMountedSectionCovers } from '../scripts/devSectionMount';
import { syncDevSectionOutlineSidebar } from '../scripts/devSectionOutlineSync';
import { positionSiteAnnotations } from '../scripts/siteAnnotationPosition';
import { refreshParagraphWrapping, serializeInlineHtml } from './devTextDom';
import { isVideoSrc } from './imageUpload.mjs';
import { normalizeHref } from './normalizeHref.mjs';
import { openPlaygroundDraft, type PlaygroundUpload } from './playgroundDraft';
import { playgroundMedia } from './playgroundMedia';
import { normalizeIntroHeight } from './projectIntro';
import { deriveNavFromOutline } from './projectOutline';
import { projectStackClass, resolveStackSpacingForIndex, spacingDevAttrs } from './projectStack';
import { renderSiteAnnotationLayer } from './siteAnnotationSvg';
import { bindImagePreviewUpgrade } from './imagePreviewUpgrade';
import { bindSafeVh } from './safeVh';

const viewportFrame = 'vcd-edit-viewport-preview';
const mediaTypes = new Set(['image', 'imageGrid', 'imageCarousel', 'placeholder']);
type Json = Record<string, any>;
type LocalUpload = PlaygroundUpload & { url: string };

async function dimensions(url: string, video: boolean) {
  if (video) {
    const element = document.createElement('video');
    return new Promise<{ srcWidth: number; srcHeight: number }>((resolve, reject) => {
      element.onloadedmetadata = () => resolve({ srcWidth: element.videoWidth, srcHeight: element.videoHeight });
      element.onerror = () => reject(new Error('This video could not be opened.'));
      element.preload = 'metadata';
      element.src = url;
    });
  }
  const image = new Image();
  image.src = url;
  await image.decode();
  return { srcWidth: image.naturalWidth, srcHeight: image.naturalHeight };
}

function readJson(selector: string) {
  return JSON.parse(document.querySelector(selector)?.textContent || 'null');
}

function restoreParagraphs(element: HTMLElement, values: string[]) {
  element.replaceChildren(...values.map((value) => {
    const template = document.createElement('template');
    template.innerHTML = value;
    const paragraph = document.createElement('p');
    paragraph.innerHTML = serializeInlineHtml(template.content);
    return paragraph;
  }));
  refreshParagraphWrapping(element, element.dataset.devTextLegacyBalance === 'true');
}

function restoreTextBlock(root: HTMLElement, section: Json, templates: DocumentFragment) {
  const field = root.querySelector<HTMLElement>('[data-dev-text-kind]');
  if (!field) return;
  if (field.dataset.devTextKind === 'paragraphs') {
    restoreParagraphs(field, section.paragraphs ?? ['']);
  } else if (section.type === 'award') {
    const href = normalizeHref(section.href ?? '') || '';
    field.textContent = href;
    const link = root.querySelector<HTMLAnchorElement>('.project-award__hit')!;
    if (href) link.href = href;
    else link.removeAttribute('href');
  } else {
    field.textContent = section.title ?? '';
  }

  if (section.type === 'sectionTitle') {
    const tag = section.level === 3 ? 'h3' : 'h2';
    if (!field.matches(tag)) {
      const heading = document.createElement(tag);
      for (const { name, value } of field.attributes) heading.setAttribute(name, value);
      heading.textContent = field.textContent;
      field.replaceWith(heading);
    }
    const visibility = {
      desktop: section.showTitle?.desktop ?? !section.hideWhenSidebarVisible,
      tablet: section.showTitle?.tablet ?? true,
      mobile: section.showTitle?.mobile ?? true,
    };
    root.dataset.devShowTitle = JSON.stringify(visibility);
    for (const [viewport, visible] of Object.entries(visibility)) {
      root.classList.toggle('project-section-title--hide-' + viewport, !visible);
    }
    root.classList.toggle('project-section-title--hide-when-sidebar', !visibility.desktop);
  }

  if (section.type === 'projectDetails') {
    const list = root.querySelector<HTMLElement>('.project-details__list')!;
    const model = list.firstElementChild ?? templates.querySelector('[data-project-details-row]')!;
    list.replaceChildren(...(section.rows ?? []).map((row: Json, index: number) => {
      const node = model.cloneNode(true) as HTMLElement;
      for (const key of ['label', 'value']) {
        const element = node.querySelector<HTMLElement>('[data-project-details-' + key + ']')!;
        element.textContent = row[key];
        element.dataset.devTextPath = JSON.stringify(['sections', 0, 'rows', index, key]);
      }
      node.querySelector('[data-project-details-actions]')?.setAttribute('aria-label', 'Row actions for ' + (row.label || 'row ' + (index + 1)));
      return node;
    }));
  }
}

function restoreSavedPage(seed: Json, data: Json) {
  if (JSON.stringify(seed) === JSON.stringify(data)) return;
  const zone = document.querySelector<HTMLElement>('[data-dev-project-drop-zone]')!;
  const templates = document.querySelector<HTMLTemplateElement>('[data-playground-block-templates]')!.content;
  const initial = new Map<string, { section: Json; root: HTMLElement }>();
  for (const [index, section] of seed.sections.entries()) {
    const path = JSON.stringify(['sections', index, 'spacing']);
    const root = zone.querySelector<HTMLElement>(":scope > [data-dev-spacing-path='" + path + "']");
    if (root) initial.set(section.id, { section, root });
  }
  const previousRoots = [...zone.children];
  const renderedRoots = new Set<HTMLElement>();
  const trailing = zone.querySelector<HTMLElement>('[data-dev-spacing-write-path]')!;
  const documentKey = data.slug;
  document.querySelector('[data-dev-text-path=\'["title"]\']')!.textContent = data.title;
  const pageShell = document.querySelector<HTMLElement>('[data-section-nav-root]')!;
  pageShell.dataset.sectionOutline = JSON.stringify(data.outline);
  pageShell.dataset.sectionNav = JSON.stringify(deriveNavFromOutline(data.outline));
  for (const [index, section] of data.sections.entries()) {
    const original = initial.get(section.id);
    const { type } = section;
    const spacing = resolveStackSpacingForIndex(index, section.spacing);
    const sameFields = JSON.stringify(section) === JSON.stringify(original?.section);
    let root = original?.section.type === type ? original.root : undefined;
    if (!sameFields || !root) {
      if (mediaTypes.has(type)) {
        const media = type === 'placeholder' ? { ...section, type: 'image', src: 'placeholder.svg' } : section;
        root = mountInsertedSection({ ...media, spacing }, documentKey, index);
      } else {
        root ??= templates.querySelector<HTMLElement>('[data-dev-section-deletable="' + type + '"]')?.cloneNode(true) as HTMLElement | undefined;
        if (root) restoreTextBlock(root, section, templates);
      }
      if (!root) continue;
      root.id = section.sectionId ?? '';
      root.classList.toggle('section-block', Boolean(root.id));
      if (section.annotations?.length || original?.section.annotations?.length) {
        renderSiteAnnotationLayer(root, section.annotations ?? []);
      }
    }
    if (!root) continue;
    const intro = section.intro === true;
    root.classList.toggle('project-block--intro', intro);
    if (intro) {
      const height = normalizeIntroHeight(data.introHeight ?? section.introHeight);
      root.dataset.devIntro = 'true';
      root.dataset.devIntroHeightDocument = documentKey;
      root.dataset.devIntroHeightPath = '["introHeight"]';
      root.dataset.devIntroHeightValue = String(height);
      root.style.setProperty('--intro-height', String(height));
    } else {
      for (const attribute of ['data-dev-intro', 'data-dev-intro-height-document', 'data-dev-intro-height-path', 'data-dev-intro-height-value']) {
        root.removeAttribute(attribute);
      }
      root.style.removeProperty('--intro-height');
    }
    for (const item of [...root.classList]) {
      if (/^project-stack--(?:(?:tablet|mobile)-)?(?:none|related|group|section|major)$/.test(item)) root.classList.remove(item);
    }
    root.classList.add(...projectStackClass(spacing).split(' '));
    root.dataset.siteAnnotationSectionId = section.id;
    root.dataset.siteAnnotationDocument = documentKey;
    for (const [key, value] of Object.entries(spacingDevAttrs(documentKey, ['sections', index], spacing, { contentId: section.id }) ?? {})) {
      root.setAttribute(key, value);
    }
    for (const node of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      for (const attr of [...node.attributes]) {
        if (!/^data-dev-.*-path$/.test(attr.name) || !attr.value.startsWith('[')) continue;
        const path = JSON.parse(attr.value);
        if (path[0] === 'sections' && path[1] !== index) {
          path[1] = index;
          node.setAttribute(attr.name, JSON.stringify(path));
        }
      }
    }
    renderedRoots.add(root);
    zone.append(root);
  }
  for (const child of previousRoots) {
    if (child !== trailing && !renderedRoots.has(child as HTMLElement)) child.remove();
  }
  if (trailing) {
    const spacing = data.trailingSpacing ?? 'none';
    trailing.className = projectStackClass(spacing);
    for (const [key, value] of Object.entries(spacingDevAttrs(documentKey, ['sections', data.sections.length], spacing, { writePath: ['trailingSpacing'] }) ?? {})) {
      trailing.setAttribute(key, value);
    }
    zone.append(trailing);
  }
}

export async function mountPlayground() {
  const root = document.documentElement;
  const seed = readJson('[data-playground-document]');
  if (!seed || !root.hasAttribute('data-editor-playground')) return;
  const documentFrame = window.parent !== window && window.name === viewportFrame;
  const embedded = window.parent !== window && !documentFrame;
  const preview = document.querySelector<HTMLButtonElement>('[data-playground-preview]')!;
  const previewLabel = preview.querySelector<HTMLElement>('[data-playground-preview-label]')!;
  const reset = document.querySelector<HTMLButtonElement>('[data-playground-reset]')!;
  const toggle = () => window.dispatchEvent(new CustomEvent('vcd:dev-mode-request', {
    detail: { active: !root.classList.contains('is-dev-mode') },
  }));
  const status = document.querySelector<HTMLElement>('[data-playground-status]')!;
  const updateStatus = (message: string) => {
    status.textContent = message;
    status.hidden = !message;
  };

  if (!embedded) root.removeAttribute('data-compact-editor');
  window.addEventListener('vcd:dev-mode-change', (event) => {
    previewLabel.textContent = (event as CustomEvent).detail?.active ? 'Preview mode' : 'Edit mode';
  });
  window.addEventListener('message', (event) => {
    if (!embedded || event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === 'vcd:editor-playground-mode') {
      const compact = event.data.desktop !== true;
      if (root.hasAttribute('data-compact-editor') === compact) return;
      root.toggleAttribute('data-compact-editor', compact);
      window.dispatchEvent(new Event('vcd:editor-compact-change'));
    } else if (event.data?.type === 'vcd:editor-playground-toggle-preview') {
      toggle();
    }
  });
  document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) event.preventDefault();
  });
  // The editor gets first use of Escape for panels and active text fields.
  window.addEventListener('keydown', (event) => {
    if (embedded && event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
      window.parent.postMessage('vcd:editor-playground-exit', location.origin);
    }
  });
  preview.addEventListener('click', toggle);
  preview.disabled = true;
  reset.disabled = true;

  const store = await openPlaygroundDraft().catch(() => {
    updateStatus('Browser storage is unavailable. Changes will last until you reload.');
    return undefined;
  });
  const draft = store?.draft?.document.slug === seed.slug ? store.draft : undefined;
  const savedAssets = (draft?.uploads ?? []).map((file) => {
    const url = URL.createObjectURL(file.blob);
    playgroundMedia.set(file.src, url);
    return { ...file, url };
  });
  const authoring = createPlaygroundAuthoring({
    seed, catalog: readJson('[data-published-demo-assets]') ?? [],
    readDraft: () => draft?.document, savedAssets, deletedSources: draft?.deleted,
    readMediaDimensions: (url: string) => dimensions(url, isVideoSrc(url)),
    upload: async ({ filename, mimeType, data }: { filename: string; mimeType: string; data: string }) => {
      const src = 'playground/' + crypto.randomUUID() + '-' + filename.split(/[/\\]/).at(-1);
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      try {
        const size = await dimensions(url, isVideoSrc(filename));
        playgroundMedia.set(src, url);
        return { src, filename, url, blob, dimensions: size };
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    },
    discardUpload: ({ src, url }: LocalUpload) => {
      playgroundMedia.delete(src);
      URL.revokeObjectURL(url);
    },
    writeDraft: (document: Json | null, assets?: { uploads: LocalUpload[]; deleted: string[] }) =>
      store?.write(document && assets ? {
        document, deleted: assets.deleted,
        uploads: assets.uploads.map(({ src, filename, blob, dimensions }) => ({ src, filename, blob, dimensions })),
      } : null),
  });

  const clientFetch = window.fetch.bind(window);
  const applyAwardSizes = () => {
    const values = authoring.snapshot().awardBlockSize;
    if (!values) return;
    document.querySelector<HTMLElement>('[data-award-block-size-panel]')!.dataset.defaults = JSON.stringify(values);
    for (const [viewport, value] of Object.entries(values)) {
      root.style.setProperty('--award-block-height-' + viewport + '-browser', value + 'px');
    }
  };
  let queue = Promise.resolve();
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return clientFetch(request);
    const endpoint = url.pathname.slice('/api/'.length);
    const run = async () => {
      if (request.signal.aborted) throw request.signal.reason;
      try {
        const body = request.body ? await request.json() : {};
        let response: Response | undefined;
        await authoring.handle(request.method, endpoint, body, (status: number, value: unknown) => {
          if (endpoint === 'award-block-size' && status === 200) applyAwardSizes();
          response = Response.json(value, { status });
        });
        return response ?? Response.json({ error: 'The edit was not saved.' }, { status: 500 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'The edit was not saved.' }, { status: 400 });
      }
    };
    const result = queue.then(run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  reset.addEventListener('click', async () => {
    reset.disabled = true;
    try {
      await queue;
      await authoring.reset();
      root.setAttribute('data-playground-resetting', '');
      location.reload();
    } catch {
      updateStatus('Could not reset the demo.');
      reset.disabled = false;
    }
  });
  restoreSavedPage(seed, authoring.snapshot());
  applyAwardSizes();
  root.setAttribute('data-playground-ready', '');
  document.dispatchEvent(new Event('vcd:playground-ready'));
  bindSafeVh();
  bindImagePreviewUpgrade();
  if (draft) {
    initMountedSectionCovers(document.querySelector<HTMLElement>('[data-dev-project-drop-zone]')!);
    syncDevSectionOutlineSidebar();
    positionSiteAnnotations();
  }
  preview.disabled = false;
  reset.disabled = false;
  if (!documentFrame) window.dispatchEvent(new CustomEvent('vcd:dev-mode-request', { detail: { active: true } }));
}
