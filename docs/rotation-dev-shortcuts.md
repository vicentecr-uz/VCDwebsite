# This plan is for use with the `qa-rotation` skill. You are the manager — read that skill before continuing.

# Dev keyboard shortcuts + asset manager — QA rotation (split ports)

## Ports

| Item | Branch | Port | PR |
| --- | --- | --- | --- |
| **T3** | `feat/dev-keyboard-shortcuts` | **4321** | [#295](https://github.com/vcruzdesigns/VCDwebsite/pull/295) — **signed** |
| **T1** | `feat/dev-option-a` | **4322** | [#296](https://github.com/vcruzdesigns/VCDwebsite/pull/296) — rework: Option+A requires Edit mode (Esc stack) |
| **T2** | `feat/dev-option-h` | **4323** | [#297](https://github.com/vcruzdesigns/VCDwebsite/pull/297) — **signed** |

## Queue

- [x] **T3 · Gallery crop → Asset manager**
- [~] **T1 · Option+A** — enter Edit + open `d85930d` — retest @4322
- [x] **T2 · Option+H**

## Follow-ups (v2)

- [#298](https://github.com/vcruzdesigns/VCDwebsite/issues/298) — Rename Dev* → Edit* identifiers
- [#299](https://github.com/vcruzdesigns/VCDwebsite/issues/299) — Esc: unify “up one UI level” toward View
- [#300](https://github.com/vcruzdesigns/VCDwebsite/issues/300) — Online Edit: gate Edit-mode shortcuts behind auth

## Signed off

- **T3** — lgtm — #295
- **T2** — lgtm — #297 (`93de30f`)
