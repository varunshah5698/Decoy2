# Aegis Sentinel — design system

The landing page is its own committed visual world. The console and access pages keep their existing dark product language; nothing in `Landing.css` is global except the `html:has(.lp)` surface rules.

## World

**Editorial, not dashboard.** The page is built as a sequence of full-bleed fields — a warm pinstriped lilac gradient, a black spotlight stage, a petrol starfield, a pure-black numbers spread, a paper-white console index, and a lilac return — each handing off to the next through a converging hairline funnel. Threat filtering is staged as a physical event: a lamp lights a rack in the dark and a CVSS 9.8 counts itself down to 0.0 because the product is not installed on that host.

Mode: **Persuade.** Audience: security leads and analysts evaluating the demo. Action: open the console.

## Palette

| Token | Value | Use |
|---|---|---|
| `--paper` / `--paper-2` | `#f4f2ee` / `#e8e4dc` | Light fields, plate surfaces |
| `--ink` / `--ink-soft` / `--ink-mute` | `#0c0d10` / `#4b4f56` / `#8a8f96` | Text on light fields |
| `--night` / `--night-2` | `#08090c` / `#0e1014` | Dark bands, footer |
| `--bone` / `--dim` / `--mute` | `#ece9e1` and alphas | Text on dark bands |
| `--lilac-a/b/c` | `#c9b6f0` `#ece8fb` `#b3a2e4` | Hero and access gradient |
| `--flame-a/b/c` | `#f0873c` `#f8cf9c` `#e2662b` | Slow amber cross-fade of the same gradient |
| `--teal` | `#53e3cb` | Filtered traffic, card marks, queue language |
| `--amber` | `#f0a94a` | Matched danger, focus ring, plate accents |

Hairlines are bone at 9% on dark and ink at 10% on light. Gradient is reserved for the two ambient fields; headline text is never gradient-filled. The lilac here is a deliberate exception to the console's no-purple rule and does not travel into `/app`.

## Typography

- **Display:** Instrument Serif at 400, `clamp`-scaled, with italic for the carried clause of every headline — "Filtering *Noise* *Threat* Early Warning", "Our *Vulnerability* Detection Services".
- **Body:** Inter Variable at 12.8–17px, 1.55–1.72 line height.
- **Metadata:** JetBrains Mono, uppercase, 10–11px, wide tracking, for indices, emails, data sources, and the footer register.

Headline voice stays two-clause and declarative. Numbers are always the real seeded ones, never invented.

## Layout

- One 1320px measure; `--edge` aligns the fixed nav, every section, and both funnel bands to the same vertical line.
- Fixed chrome is three floating pills — brand, centred links, light CTA — so the nav reads on both the lilac and the petrol worlds.
- Section order: hero → gate stage → funnel → about spread → services starfield → numbers → funnel → console index → access → footer.
- Capability cards staircase right by 17% per row on a translucent petrol panel; console tiles stagger vertically instead of gridding.
- Breakpoints at 1180, 780 and 460. Below 780 the ambient glyph field and the about scribble drop out, the gate readout moves left and gets its own darkened field for legibility, and below 460 the nav links collapse to logo plus CTA.

## The gate scene

`src/scenes/GateScene.tsx` is a real-time Canvas 2D pseudo-3D composition, not an image or video.

- Warm bloom, a volumetric cone from the lamp to the rack, rack silhouette with teal slot lines and amber LEDs, drifting packets (amber = match, teal = filtered), dust in the beam, vignette.
- Scroll progress through the section drives the camera and counts the CVSS of CVE-2023-23397 from 9.8 to 0.0 in the DOM readout; pointer position eases the beam.
- `prefers-reduced-motion` draws one static frame at the filtered end state and pins the counter at `0.0`.

## Artwork

`src/pages/LandingArt.tsx` carries the still-life plates — bell, rack, gauge, terminal, console, shield — as engraved SVG on a grain-textured plate, plus the about scribble and the line-art glyphs that sit inside each capability card. Photography is not used; the image generator was unavailable during this build.

## Interaction & accessibility

- All interactive elements are real buttons/links; focus uses a 2px amber ring with offset.
- Demo paths are unchanged: **Open demo** signs in the analyst and opens `/app`; role cards sign in as admin or analyst; console and capability rows route to `/login?next=…` when signed out.
- Reveals run once per element through IntersectionObserver and never replay on scroll-up.
- Text contrast: ink on paper and bone on night both exceed 12:1; micro labels are metadata and never the only carrier of an action.
- Verified at 390, 1024 and 1440 widths plus reduced motion; `overflow-x: clip` on the root, no horizontal overflow.

## Files

- `src/pages/Landing.tsx` — page, seeded data composition, demo routing
- `src/pages/Landing.css` — the scoped `.lp` world
- `src/pages/LandingArt.tsx` — SVG plates, scribble, glyphs
- `src/scenes/GateScene.tsx` — Canvas gate scene
- `PRODUCT.md` — product truth and surface map
