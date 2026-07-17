# Vendored Hyperellipse (patched)

Based on [`hyperellipse@1.0.5`](https://www.npmjs.com/package/hyperellipse).

**Why vendored:** Upstream fallback approximates each corner as a polyline (`L` segments, max 26). That reads as facets in Firefox/Safari (Zen) at normal zoom. Chromium is unaffected (native `corner-shape`).

**Patch:** Hermite → cubic Bézier (`C`) path commands for clip-path / SVG layers, with end tangents locked to the incoming/outgoing straight edges (avoids the 1px “nub” from Catmull–Rom pulling the first control inward). Denser sampling. Shadows, borders, and outlines still use Hyperellipse’s existing SVG layer machinery — only the path geometry changed.

Do not reinstall from npm without re-applying this patch.
