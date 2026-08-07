# Remaining gallery / cutover polish — queue

**Updated:** 2026-08-07 after #171 / #167 / #193 merged. Checkout should be `main`.
**Audience:** manager session (diagnose → spec → worker → review → Anto test).

---

## Done (this track)

| Issue | State |
| --- | --- |
| #171 Play card parity | ✅ PR #190 |
| #167 Gallery Manager card template | ✅ PR #191 |
| #193 One project-card engine (kill play-links; teaser = visibility) | ✅ PR #195 |
| #194 Esc exits Edit without discarding | ✅ |

---

## Queue (do in this order)

1. **[#192](https://github.com/vcruzdesigns/VCDwebsite/issues/192)** — Public → Teaser/Draft stops serving `/slug` after Save & Publish  
2. **[#196](https://github.com/vcruzdesigns/VCDwebsite/issues/196)** — Revert when only unpublished (disk) changes: keep Revert; discard local branch drift to match remote  
3. **[#185](https://github.com/vcruzdesigns/VCDwebsite/issues/185)** — Replace cover from asset manager  
4. **[#184](https://github.com/vcruzdesigns/VCDwebsite/issues/184)** — **Verify** existing `⋮` Delete (create throwaway project, delete, confirm). Rebuild only if broken  
5. **[#181](https://github.com/vcruzdesigns/VCDwebsite/issues/181)** — One editing affordance at a time  
6. **[#197](https://github.com/vcruzdesigns/VCDwebsite/issues/197)** — Project page **video player** (v1 cutover)

Then: content for v1 / Webflow swap. Small polish as it comes up.

### Deferred

- **#172** adaptive cover contrast — **next site version** (not v1)  
- **#168** second dev mode — design first  

---

## Traps (carry into every worker spec)

1. `listingCardForGrid` is an **allowlist** — new fields need `previous.*` fallback; save twice to test.  
2. New listing fields need **six** thread points (incl. page mappers).  
3. Plain `<script>`, not `type="module"`, in Astro page scripts.  
4. `is:global` style blocks must **not** leave literal `:global(…)` wrappers (invalid CSS; title ink died that way).  
5. Stale Vite transforms — restart `dev:session` before blaming CSS.  
6. No silent fallbacks in new fill paths — `console.warn`.  
7. Bun: `$HOME/.bun/bin/bun`. No second dev server. `commit:engine` with explicit paths; never stage content unless schema migration.

---

## Verification

Anto tests; agents hand a numbered script and stop. Build ≠ verification.
