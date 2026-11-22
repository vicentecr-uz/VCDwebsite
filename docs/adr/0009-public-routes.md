# 0009. Public routes

Status: Accepted (2026-11-22, recorded from code comments)

## Decision

**Sabi docs live on their own host.** `sabi.vicentecr.uz` serves the `/sabi` page at its root plus the documentation paths; the Cloudflare Pages middleware redirects portfolio `/sabi` paths there and maps renamed docs paths (the sabi-input 0.1.0 README on npm still links `/getting-started`). Deployed builds therefore link docs pages from the root, not `/sabi`, to avoid a redirect per click; dev keeps the `/sabi` base.

**Short profile links are bare pages.** `/ig`, `/instagram` (alias, so curious hits do not 404), `/github`, `/linkedin`, `/threads` and `/x` redirect home with Umami campaign parameters. They render without the layout or analytics so only the destination is tracked.

**Routable projects.** In dev every modern project is routable so authors can open teasers and drafts; image-only entries never get a `/slug`. In production only published projects route; a teaser card still appears on galleries but its page does not exist, the same non-discovery as a draft.

**Write-up share cards** render with the bundled Hanken Grotesk TTF through Fontconfig (macOS Pango otherwise defaults to Core Text).

**Share metadata is absolute.** `site` in `astro.config.mjs` is a real origin and `Layout.astro` builds canonical and `og:image` URLs from it, because scrapers and search engines ignore relative ones.

## Where

`functions/_middleware.ts` → `RENAMED`, `onRequest`; `src/pages/sabi/[page].astro` → `base`; `src/pages/{ig,instagram,github,linkedin,threads,x}.astro`; `astro.config.mjs` → `site`; `src/layouts/Layout.astro` → `canonical`; `src/lib/projects.ts`; `src/lib/writeupShareCard.ts`
