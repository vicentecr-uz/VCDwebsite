# Legacy case-study components

Webflow-migration components kept only while old case-study routes are rebuilt
(The Rams, Conic Collection, ParentPal, [retired-project]).

**Do not use on new work.** Signed-off components live in `src/components/project/`
and are listed on `/styles`.

`LegacyProjectSections.astro` is the section renderer for legacy JSON content.
It may import signed-off components (`ProjectImage`, `ProjectImageGrid`, etc.)
where those section types overlap with Tapico.

`ProjectGrid` (site listings at `src/components/ProjectGrid.astro`) is separate from
`LegacyProjectGrid` here. Other freed names include `ProjectProse`, `ProjectTagline`, etc.
