# This plan is for use with the `qa-rotation` skill. You are the manager — read that skill before continuing.

# Adaptive media ink — QA rotation (split ports)

## Ports

| Item | Branch | Port | Notes |
| --- | --- | --- | --- |
| **main** | `main` | **4321** | Untouched checkout |
| **T1** | `feat/media-ink-t1` | **4322** | Signed |
| **T2** | `feat/media-ink-t2` | **4323** | Signed |
| **T3** | `feat/media-ink-t3` | **4324** | Signed |
| **T4** | `feat/media-ink-t4` | **4325** | Signed |
| **T5** | `feat/media-ink-t5` | **4327** | Signed |
| **T6** | `feat/media-ink-t6` | **4328** | Signed (`13b17b3`) |
| **T7** | `feat/media-ink-t7` | **4329** | Signed (`27bd8d7`) |
| **T8** | `feat/media-ink-t8` | **4330** | **Merged to `main`** (`c48102d`) |

## Queue

- [x] **T1–T8b** — merged to `main` (adaptive media ink + caption tuner)
- [ ] **T9 · Caption format bar (bold only)** — after F4 (`feat/dev-format-bar-dropdown`); same file `DevTextEditor.astro`
- [ ] **T10 · Other project-page overlays** — later
