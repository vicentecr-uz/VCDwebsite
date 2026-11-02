import { fileURLToPath } from 'node:url';

// These are authoring entrypoints. DevOverlay and ui/* also serve public /styles demos.
// Keep new writers here; check-production-output catches emitted authoring endpoints.
const authoringComponents = new Set([
  'DevAssetManager.astro',
  'DevAwardBlockSize.astro',
  'DevVideoEditor.astro',
  'dev/DevCarouselDragTool.astro',
  'DevGalleryPages.astro',
  'DevGalleryReorder.astro',
  'DevImageDrop.astro',
  'DevImageDescriptions.astro',
  'DevLogIssue.astro',
  'DevModeController.astro',
  'DevNewProject.astro',
  'DevPageColumn.astro',
  'DevPageWidthToggle.astro',
  'DevProjectGridEditor.astro',
  'DevSectionReorderEditor.astro',
  'DevShortcutsHelp.astro',
  'DevTextEditor.astro',
  'DevComponentNotes.astro',
  'DevThemeToggle.astro',
  'StyleColorTokenEditor.astro',
  'archive/ArchivedDevPanels.astro',
  'archive/DevHeaderSurfaceTuner.astro',
  'project/ProjectImageCaptionTuner.astro',
  'project/ProjectImageCarouselTuner.astro',
  'project/ProjectImageCropTuner.astro',
  'project/ProjectImageGridTuner.astro',
  'project/ProjectSectionNavEditor.astro',
  'project/archive/ProjectCaptionShadowTuner.astro',
].map((file) => fileURLToPath(new URL(`../src/components/${file}`, import.meta.url))));

export function productionBoundary() {
  return {
    name: 'vcd-production-boundary',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      // Remove the component before Astro discovers its scripts, styles, or imports.
      if (authoringComponents.has(id.split('?')[0])) return '';
    },
  };
}
