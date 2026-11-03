# Colour roles

Choose ink by the job the text does. Required reading, readable supporting content and optional metadata are separate roles. Faint metadata is not a general "make it lighter" colour.

## Text

| Role | Token | Use |
| --- | --- | --- |
| Primary reading | `--sys-color-on-srf` | Body paragraphs, field labels, current navigation and text needed to understand or complete a task. |
| Readable supporting content | `--sys-color-on-srf-variant` | Secondary content that still needs to be read, including supporting copy and functional labels. |
| Optional metadata | `--sys-color-on-srf-subtle` | Attribution, navigation group headings and pagination captions whose omission would leave the content and actions understandable. |

Use this decision flow for text on the page ground:

```text
Can the reader skip it without losing content or an action's meaning?
├─ Yes, and it is metadata → on-srf-subtle
└─ No
   ├─ Supporting copy or a functional label → on-srf-variant
   └─ Main reading, a field label or current navigation → on-srf
```

Use the component's existing role for functional links. Documentation's inactive contents links use `--documentation-navigation-muted`; their current state uses `--sys-color-on-srf`. An inactive link remains an action, so it must not use the faint metadata role.

In documentation, "by Vicente Cruz", "Basics", "API", "Guides", "On this page", "Previous" and "Next" use `--sys-color-on-srf-subtle`. The linked page titles beside Previous and Next remain readable navigation. The attribution is optional even when the author's name is a link.

Use `--sys-color-on-srf` for a body paragraph or form field label. Use `--sys-color-on-srf-variant` for supporting prose that explains a feature. Do not apply `--sys-color-on-srf-subtle` to either to reduce its visual weight.

## Metadata and hairlines

`sys.color.on-srf-subtle` aliases `{sys.color.outline}` in both modes. This keeps optional metadata at the same tone as the default horizontal `Hairline`, while callers still choose the token by semantic purpose.

- Text metadata uses `--sys-color-on-srf-subtle`.
- Editorial dividers and rules use `--sys-color-outline`, or the existing `Hairline` component.
- Drawer borders and component frame edges may use `--sys-color-outline-variant`. Keep each primitive's existing edge treatment; a Menu-owned separator does not become an editorial divider.

Do not use `--sys-color-outline` as text ink just because it resolves to the same colour. The alias owns the shared tone, so future token changes keep text and rules connected without conflating their roles.

## Example

The attribution selector in `src/layouts/DocumentationLayout.astro` is optional metadata. Its former supporting-copy role is the concrete misuse this rule replaces.

```css
/* Correct: optional attribution. */
.documentation-brand span { color: var(--sys-color-on-srf-subtle); }

/* Incorrect for this attribution: readable supporting-copy ink. */
.documentation-brand span { color: var(--sys-color-on-srf-variant); }
```

## Token layers and foreground context

At call sites, use semantic tokens or an existing component role. Do not copy palette references, literal colours or opacity adjustments to imitate a role. The definition of a component role owns its backing token; its consumers use the role.

These rules apply on the page ground. Inverse surfaces, media overlays and gallery covers retain their own foreground roles and luminance handling. Do not replace them with page-ground ink to match a screenshot.

## Sources

- `tokens/design-tokens.json` defines the three text roles and the outline alias.
- `src/styles/global.css` contains the generated CSS variables.
- `src/components/ui/Hairline.astro` and `.dev-hairline` in `src/styles/dev-chrome.css` supply the default horizontal hairline.
- `DocumentationLayout.astro`, `DocumentationNavigation.astro` and `DocumentationContents.astro` under `src/layouts/` or `src/components/` contain the documentation call sites.

The role alias and documentation examples are defined in [PR #177](https://github.com/vicentecr-uz/VCDwebsite/pull/177).
