# Menus and floating layers

Read when building a menu, dropdown, listbox, popover or tooltip.

## Floating layers

Menus, dropdowns, listboxes, popovers and tooltips open in the native top layer: put `popover="manual"` on the floating element, open it with `showPopover()`, and place it with `position: fixed` in viewport coordinates using `placeBeside()` / `clampToViewport()` from `src/lib/floatingLayer.ts`. The one select, `EditorSelectField` (Base UI), is the exception: Base UI positions its popup and aligns the selected option with the trigger. It portals to `body`, or into an enclosing modal `<dialog>` so it paints in that dialog's top layer. Every `.project-block` is a stacking context (`isolation: isolate` from `site-annotations.css`) and, through `container-type: inline-size`, the containing block for `position: fixed`. So a layer inside one block paints under the next block whatever its `z-index`, and `position: fixed` alone does not escape. Never fix draw order by raising a block's `z-index`.

In the popover's CSS, reset the UA defaults (`inset: auto; margin: 0; border: 0; overflow: visible`) and set `display` only under `:popover-open`, so the closed popover stays `display: none`. The element stays in its DOM position, so `:has()`, `:hover`, inheritance and event delegation still work; ancestor `opacity` no longer applies to it.

`bun test scripts/test/top-layer-floating.test.ts` fails when an element with `role="menu"`, `"listbox"` or `"tooltip"` renders without `popover`. A layer that genuinely never sits inside a block, such as an inline toolbar row or a node appended to `<body>`, goes on the test's exemption list with a reason. Do not add an exemption for a layer that renders inside a block.

## Menus

Every dropdown menu and listbox is a `Menu` (`src/components/ui/Menu.astro`, `.dev-menu`). Assemble it from `.dev-menu__item` rows (ghost `Button`, align start, width fill) and `Hairline` separators, then place it with `src/lib/floatingLayer.ts`. The component owns the rest: padding equal to the 4px row gap, concentric corners (row radius + padding), separator inset and colour, the selected-row fill with hover one step darker, and opening and closing in the top layer instantly (menus are frequent, often keyboard-driven tools, so they don't fade). Never set menu padding, gap, radius or separator spacing at the call site; change `.dev-menu` in `dev-chrome.css` so every menu moves together. The same test fails when a top-layer menu or listbox lacks `.dev-menu`, and `dev-chrome-ownership.test.ts` fails on a call-site override of its spacing. A select's trigger value and its options read one token, `--dev-text-select-value` (the Menu row size), so the open listbox overlays the value exactly; never set either font on its own.
