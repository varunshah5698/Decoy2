# Aegis Sentinel

Version-aware threat early warning, demonstrated as a self-contained web product.

## Product truth

- **What it is:** a security product that correlates the global CVE firehose (NVD, CISA KEV, FIRST EPSS) with a company's own asset inventory down to the installed version, then produces a deterministic 0–100 score and a plain-language verdict.
- **Core mechanism:** a version relevance gate. A high CVSS on software you don't run scores 0.0; a matched version outranks the raw severity of a headline CVE. Scores are arithmetic over six weighted inputs and are fully reproducible.
- **Audience:** security leads and analysts who are drowning in alerts and need to know which threats can actually reach their estate. Secondary: technical evaluators opening the demo.
- **Roles:** `ADMIN` (full workspace, ingestion, simulator) and `ANALYST` (triage and investigation only). Demo credentials: `admin@aegis.demo` / `analyst@aegis.demo`, password `aegis-demo-2026`.
- **Current data:** 18 seeded CVEs, 16 assets, 13 active alerts, 2 suppressed by the version gate. Real CVE identifiers; simulated inventory and scores, labelled as such everywhere.
- **Deployment:** Vercel (`aegis-sentinel-blush.vercel.app`) for the app; Render (`decoy2.onrender.com`) for the AI proxy; AI is a server-side River proxy, never browser-exposed.
- **Brand commitments:** teal + amber on near-black; the shield mark; the name Aegis Sentinel; a demo-first, honest tone (simulated data always labelled). A separate light theme exists in the app, but the landing surface is a committed dark "operations room" world.

## Surfaces

- `/` — landing, Persuade. Cinematic 3D server-under-attack hero and product proof.
- `/login` — access, Operate.
- `/app/*` — console, Operate.

## Constraints

- Static frontend, no new runtime services required for the landing.
- Must work at 390–1600 px, reduced motion, keyboard, and with the existing theme store for the rest of the app.
- Do not expose or commit secrets. AI key remains server-side.
