# Aegis Sentinel — design system

The landing page is its own committed visual world. The console and access pages keep their existing dark product language; nothing in `Landing.css` is global except the `html:has(.lp)` surface rules.

## World

**Black-site operations room.** A version gate is staged as a physical event: hostile traffic crosses the room, strikes a shielded server monolith, and almost everything is filtered. A rare matched exploit breaks through in amber and lights the exact rack unit. The page reads as night-shift telemetry, not a SaaS landing page.

Mode: **Persuade.** Audience: security leads and analysts evaluating the demo. Action: open the console.

## Palette

| Token | Value | Use |
|---|---|---|
| `--ink` | `#040607` | Landing field |
| `--ink-2` / `--ink-3` | `#070a0b` / `#0a0e10` | Panels, nested surfaces |
| `--bone` | `#e9e7de` | Primary text |
| `--dim` | `#a8ada7` | Body copy |
| `--mute` | `#8b928d` | Metadata |
| `--teal` | `#53e3cb` | Shield, telemetry, filtered traffic |
| `--amber` | `#f0a94a` | Matched danger, primary CTA, breach |
| `--red` | `#ff5b4d` | Hostile origin and attack packets only |

Hairlines use bone at 5.5–10% alpha. No glassmorphism, no gradient text, no colored card shadows, no purple.

## Typography

- **Display:** Archivo Variable, tight tracking (`-0.038em`), weights 560–640. The h1 and section h2s set the scale using `clamp`.
- **Accent:** Instrument Serif italic for the second clause of every headline, in amber where it carries the argument.
- **Data / UI:** JetBrains Mono Variable, uppercase, 8–11px, wide tracking, for ledgers, labels, terminals, and scores.
- Body copy stays Inter at 15–17px with 1.65 line height.

Headline voice: two-clause declaratives. "The internet is loud. Your breach is specific." "The score keeps no secrets." No eyebrows, no badge pills.

## Layout

- One 1320px content measure; edge token aligns fixed HUD, nav, and ledger to the same vertical line.
- The hero is `100svh`: full-bleed attack scene, bottom-left copy, bottom-right incident terminal, a four-column telemetry ledger on the hero floor.
- Section rhythm is asymmetric split columns (copy left, proof right) separated by 1px rules rather than cards. The console index is a 17-row two-column register; the roles section is a two-register spread.
- Mobile collapses to one column at 390px with the ledger at 2×2 and the terminal hidden, keeping the scene and copy.

## The attack scene

`src/scenes/ServerAttackScene.tsx` is a real-time Canvas 2D pseudo-3D scene, not an image or video.

- Perspective projection with a fixed rack, two distant racks, floor grid, scan line, and dust.
- Red hostile origins (screen-anchored, labelled with IPs and intent) fire dotted attack arcs and spurts of packets. Most packets are filtered at the teal shield; matched packets pass through, flash amber, spark, and light a rack unit.
- Camera responds subtly to pointer and scroll; audio never plays.
- The scene owns a DOM HUD: live counts, last breach, and an incident terminal with a manual **Trigger attack** control.
- `prefers-reduced-motion` renders a single static composition with fixed counts and no trigger; the DOM never animates.

## Interaction & accessibility

- All interactive elements are real buttons/links; focus uses a 2px amber ring on the dark field.
- Demo paths: **Open demo** signs in the analyst and opens `/app`; role rows sign in admin or analyst; console index rows route to `/login?next=…` when signed out.
- Landing scrolls smoothly to anchors; nav gets a hairline and blur after 24px.
- Text contrast: bone on ink > 15:1, dim > 8:1; micro labels are metadata and never the only carrier of an action.
- Tested at 390, 1024, 1440, and 1600 widths, plus reduced motion. No horizontal overflow.

## Files

- `src/pages/Landing.tsx` — page, data composition, demo routing
- `src/pages/Landing.css` — scoped `.lp` world and `.sa-*` scene HUD
- `src/scenes/ServerAttackScene.tsx` — Canvas attack scene
- `PRODUCT.md` — product truth and surface map
