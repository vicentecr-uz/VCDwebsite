# 0011. Media rendering

Status: Accepted (2026-11-22, recorded from code comments)

## Decision

**Previews upgrade without moving the page.** Images load a thumbnail first and swap to the preview once it is decoded (`createImagePreviewUpgrade`).

- WebKit zeroes intrinsic size when `src` changes, and the wipe clone is absolutely positioned, so the image's `aspect-ratio` is pinned from known dimensions first. Without that, in-flow thumbnails collapse and the page jumps until the preview decodes.
- WebKit can also blank the original during a `src` change, so the pair is kept until the new one paints. The preload and the visible clone decode separately, so the thumbnail stays until the reveal layer itself has pixels.
- The thumbnail (640) and preview (2560) round `fit: inside` differently, so a frame with `aspect: "original"` locks its ratio once and ignores the preview's (`originalRatioLocked`).
- Display tiers are derived URLs; the JSON `src` always stays the original filename (`projectImageTier`).

**Video.** Ambient autoplay loops resume when the viewer returns; a video the viewer started stays paused. Play and pause run synchronously from the control so the user gesture survives for delayed playback. Shadow-DOM range inputs cannot expose `:focus-visible` to outside selectors, so keyboard focus is mirrored onto the host.

**Uploads.** Some browsers report HEIC with an empty MIME type; only the known HEIC extensions are accepted in that case.

**Lens.** The refraction bounds use IOR 1.5, which limits ray slope to √(1.5² − 1); 12 px covers colour pickup and antialiasing. Positive refraction bends inward, so a ray can cross the centre; the bounds allow for that and the 0.9 px chromatic offset. Rim colour pickup deliberately samples the uniform frame fill, not its inset shadow.

## Where

`src/lib/imagePreviewUpgrade.ts`; `src/lib/images.ts` → `projectImageTier`; `src/lib/projectCropCover.ts`; `src/lib/projectVideoControls.ts`; `src/lib/imageUpload.mjs`; `src/lib/imageLensBounds.ts`
