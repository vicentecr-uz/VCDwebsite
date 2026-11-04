# Colour roles

Choose ink by the job the text does. Required reading, readable supporting content and optional metadata are separate roles. Optional metadata uses a lighter ink; its token is not a general "make it lighter" colour for required reading.

## Text

| Role | Token | Use |
| --- | --- | --- |
| Primary reading | `--sys-color-on-srf` | Body paragraphs, field labels, current navigation and text needed to understand or complete a task. |
| Readable supporting content | `--sys-color-on-srf-variant` | Secondary content that still needs to be read, including supporting copy and functional labels. |
| Optional metadata | `--sys-color-on-srf-subtle` | Publishing dates, attribution, navigation group headings and pagination captions whose omission would leave the content and actions understandable. |

Use this decision flow for text on the page ground:

```text
Can the reader skip it without losing content or an action's meaning?
├─ Yes, and it is metadata → on-srf-subtle
└─ No
   ├─ Supporting copy or a functional label → on-srf-variant
   └─ Main reading, a field label or current navigation → on-srf
```

Use the component's existing role for functional links. Documentation's inactive contents links use `--documentation-navigation-muted`; their current text and section marker use `--sys-color-on-srf`. An inactive link remains an action, so it must not use the optional metadata role.

In documentation, "by Vicente Cruz", "Basics", "API", "Guides", "On this page", "Previous" and "Next" use `--sys-color-on-srf-subtle`. The linked page titles beside Previous and Next remain readable navigation. The attribution is optional even when the author's name is a link.

Use `--sys-color-on-srf` for a body paragraph or form field label. Use `--sys-color-on-srf-variant` for supporting prose that explains a feature. Do not apply `--sys-color-on-srf-subtle` to either to reduce its visual weight.

## Metadata and hairlines

`sys.color.on-srf-subtle` uses `ref.palette.grey.500` in light mode (`#888888`, about 3.54:1 against white) and `ref.palette.grey.600` in dark mode (`#aeaeaf`). The lighter light-mode metadata is an explicit visual choice and does not meet the usual 4.5:1 contrast target for regular small text. Keep it to optional metadata; use the supporting or primary role whenever the text is needed to understand content or complete an action.

The editor’s **Subtle** inline style (`.text-subtle`) uses this semantic token. Dates remain ordinary authored text, with no date schema or formatting token. The light-mode choice is the closest existing palette grey to the effective `#999999` used for publishing dates on [benji.org](https://benji.org/stageshow), rather than a new copied colour.

- Text metadata uses `--sys-color-on-srf-subtle`.
- Editorial dividers and rules use `--sys-color-outline`, or the existing `Hairline` component.
- Drawer borders and component frame edges may use `--sys-color-outline-variant`. Keep each primitive's existing edge treatment; a Menu-owned separator does not become an editorial divider.

Text and decorative rules have separate contrast requirements. Do not use `--sys-color-outline` as text ink: a hairline can be fainter than readable text. The same numeric colour also has different optical weight in a rule and antialiased letterforms, so choose each role for its purpose rather than matching their values.

## Quiet controls in editing chrome

Faint ink is for low-emphasis dev controls and glyphs at rest (unselected toggles, select chevrons, help glyphs), and it depends on the surface the glyph is drawn on:

| Surface | sys role (light / dark) | comp token |
| --- | --- | --- |
| Panel surface (`srf`) | `--sys-color-on-srf-faint` (grey-700 / grey-300) | `--comp-button-label-faint` |
| Field and soft-button fills (`srf-container-low`, `srf-container`) | `--sys-color-on-srf-container-faint` (grey-600 / grey-400) | `--comp-field-icon` |

Pick the token by the fill directly behind the glyph. Faint ink is never text ink (about 1.5–2:1); quiet text in dev chrome still uses `--comp-button-label-subtle` or `--sys-color-on-srf-subtle`. Public-site controls (such as the Sabi demo's replay button) keep `--comp-button-label-subtle`.

Figma's `on-srf-subtle` variable resolves to `palette/grey/700`, the value code used until the metadata role moved to grey500. Code's `on-srf-faint` is that Figma value; code's `on-srf-subtle` is the optional-metadata role above. Mirror both in Figma so the names line up.

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

- `tokens/design-tokens.json` defines the three text roles and separate outline roles.
- `src/styles/global.css` contains the generated CSS variables.
- `src/components/ui/Hairline.astro` and `.dev-hairline` in `src/styles/dev-chrome.css` supply the default horizontal hairline.
- `DocumentationLayout.astro`, `DocumentationNavigation.astro` and `DocumentationContents.astro` under `src/layouts/` or `src/components/` contain the documentation call sites.

The metadata role and documentation examples are defined in [PR #177](https://github.com/vicentecr-uz/VCDwebsite/pull/177).
