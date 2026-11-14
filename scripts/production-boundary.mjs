import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const component = (file) => fileURLToPath(new URL(`../src/components/${file}`, import.meta.url));
const playgroundPage = fileURLToPath(new URL('../src/pages/preview/editor-playground.astro', import.meta.url));
const projectEditor = component('ProjectEditor.astro');
const emptyEditor = component('__empty-authoring.astro');

// DevOverlay and ui/* also serve public /styles demos.
const ownerComponents = new Set([
  'dev/DevCarouselDragTool.astro',
  'DevGalleryPages.astro',
  'DevGalleryReorder.astro',
  'DevLogIssue.astro',
  'DevNewProject.astro',
  'DevPageWidthToggle.astro',
  'DevProjectGridEditor.astro',
  'DevComponentNotes.astro',
  'DevThemeToggle.astro',
  'StyleColorTokenEditor.astro',
  'archive/ArchivedDevPanels.astro',
  'archive/DevHeaderSurfaceTuner.astro',
  'project/archive/ProjectCaptionShadowTuner.astro',
].map(component));

const playgroundComponents = new Set([
  'ProjectEditor.astro',
  'DevAssetManager.astro',
  'DevAwardBadgeSize.astro',
  'DevAwardBlockSize.astro',
  'DevImageDescriptions.astro',
  'DevImageDrop.astro',
  'DevModeController.astro',
  'DevPageColumn.astro',
  'DevRedditBoardHeight.astro',
  'DevSectionReorderEditor.astro',
  'DevShortcutsHelp.astro',
  'DevTextEditor.astro',
  'DevVideoEditor.astro',
  'DevViewportPreview.astro',
  'project/ProjectImageCaptionTuner.astro',
  'project/ProjectImageCarouselTuner.astro',
  'project/ProjectImageCropTuner.astro',
  'project/ProjectImageGridTuner.astro',
  'project/ProjectSectionNavEditor.astro',
].map(component));

export function productionBoundary() {
  return {
    name: 'vcd-production-boundary',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.astro')) return;
      const from = importer.split('?')[0];
      if (from === playgroundPage || from === projectEditor) return;
      if (playgroundComponents.has(resolve(dirname(from), source))) return emptyEditor;
    },
    load(id) {
      // Remove the component before Astro discovers its scripts, styles, or imports.
      if (id === emptyEditor || ownerComponents.has(id.split('?')[0])) return '';
    },
  };
}
