# Deploying Aegis Sentinel

Live deployments: <https://aegis-sentinel-blush.vercel.app> (Vercel project `aegis-sentinel`) and
<https://decoy2.onrender.com/app> (Render service `decoy2`). Both are connected to the Decoy2 repository, so pushes
to `main` deploy production automatically.

The app is a static Vite build plus one server-side endpoint, `POST /api/ai/chat`, which streams answers from River AI. The endpoint must run on a server: a static-only host would leave the copilot unavailable. The copilot lives on its own page at `/app/ai`.

The River key is read only from the server environment. Never put it in a `VITE_` variable, in client code, or in git. Locally it lives in `.env.local`, which is ignored.

## Option 1 — Vercel (recommended)

`vercel.json` is already configured: Vite build, SPA fallback, and the Node function at `api/ai/chat.js` with a 60 second limit.

1. Push this repository to GitHub (already done).
2. In Vercel, **Add New → Project → Import** the repository.
3. Framework preset: **Vite**. Build command `npm run build`, output `dist` (read from `vercel.json`).
4. Add environment variable `RIVER_API_KEY` for Production and Preview. Optionally add `RIVER_BASE_URL` and `RIVER_MODEL`.
5. Deploy. The function is served at `/api/ai/chat` automatically.

CLI alternative:

```bash
npm i -g vercel
vercel            # preview deployment
vercel --prod     # production deployment
```

Set the key first with `vercel env add RIVER_API_KEY` (choose Production, Preview and Development).

## Option 2 — Render (blueprint)

`render.yaml` describes the whole service, so Render can create it from the repository without manual settings.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/varunshah5698/Decoy2)

1. In Render, **New → Blueprint** and connect the Decoy2 repository (or use the button above).
2. Render reads `render.yaml` and proposes the `aegis-sentinel` web service (this deployment is named
   `decoy2`):
   - Build: `npm ci --include=dev && npm run build`
   - Start: `npm start` (serves `dist` and `/api/ai/chat` from one Node process)
   - Health check: `/api/health`
   - Auto-deploy on every push to the connected branch
3. When prompted, paste the value for `RIVER_API_KEY`. It is marked `sync: false`, so the key is never stored in the repo and must be entered in the Render dashboard.
4. Apply the blueprint. The first deploy builds the SPA and starts the server.

The free plan sleeps after idle traffic; the first request after a sleep takes a few seconds. Upgrade the plan for always-on use.

`RIVER_BASE_URL` and `RIVER_MODEL` are set in the blueprint. Override them in the dashboard if the provider changes.

### If the AI page says "not configured"

The key is intentionally never committed, so a service created before the variable was entered will start without it. Open the Render dashboard and fix it on the running service:

1. Select the service (for this repository: `decoy2`).
2. **Environment → Environment Variables → Add Environment Variable**.
3. Key: `RIVER_API_KEY`. Value: the same value as in `.env.local` (copy the line, never paste it into chat or commit it). Do not prefix it with `VITE_`.
4. Save. Render restarts the service; if it does not, use **Manual Deploy → Deploy latest commit**.
5. Check `https://<your-service>.onrender.com/api/health`. It must return `"aiConfigured": true` before the copilot can answer.

For the current deployment that URL is <https://decoy2.onrender.com/api/health>. If it still reports `false`, the variable was added to a different service or environment group, or the value is empty.

## Option 3 — Netlify

`netlify.toml` builds with Vite, publishes `dist`, rewrites unknown paths to `index.html`, and routes `/api/ai/chat` to the streaming Edge Function in `netlify/edge-functions/ai-chat.js`.

1. **Add new site → Import an existing project** and pick the repository.
2. Build command and publish directory come from `netlify.toml`.
3. Add environment variable `RIVER_API_KEY` under **Site configuration → Environment variables**.
4. Deploy.

CLI alternative:

```bash
npm i -g netlify-cli
netlify env:set RIVER_API_KEY rv_your_key
netlify deploy --build --prod
```

## Option 4 — Any Node host (Railway, Fly, Docker, VPS)

The included server serves the built SPA and the AI endpoint from one process.

```bash
npm ci
npm run build
RIVER_API_KEY=rv_your_key npm start
```

- Start command: `npm start`
- Port: the server reads `PORT` (default `4173`) and binds `0.0.0.0`.
- Environment: `RIVER_API_KEY` is required; `RIVER_BASE_URL` and `RIVER_MODEL` are optional.
- Locally, `npm start` also reads `.env.local` or `.env` if present. Host environment variables win.
- Health check: `GET /api/health` returns `{ "ok": true, "aiConfigured": true }`.

For a Docker host, build with `npm ci && npm run build` and run `node server/standalone.mjs` with `RIVER_API_KEY` supplied at runtime.

## Local verification

```bash
npm install
cp .env.example .env.local     # then set RIVER_API_KEY
npm run dev                    # Vite dev server with the AI proxy
```

Production-mode check:

```bash
npm run build
npm start
```

Open the URL, sign in with `admin@aegis.demo` or `analyst@aegis.demo` (demo password `aegis-demo-2026`), then open **AI Analyst** in the sidebar (or press `Ctrl/⌘ + I`) and ask a question. If the reply is a local greeting, the client is working but the server key is missing; check `/api/health`.

## Live decoy portal (Render)

The Northwind sign-in portal is a separate Node service from
<https://github.com/Bloom-247/hakkk>. The deployed pair is:

- Portal: <https://hakkk.onrender.com>
- Console: <https://decoy2.onrender.com/app>

The portal records every attempt and exposes `/api/events`; the Aegis browser client polls that endpoint in
production and uses the Vite `/api/portal` proxy locally. The portal links back to `/app`, `/app/anomalies` and
`/app/uploads` using `AEGIS_CONSOLE_URL`, which its `render.yaml` defaults to <https://decoy2.onrender.com>.

`VITE_PORTAL_API_BASE` defaults to <https://hakkk.onrender.com> for non-local builds and is declared in
`render.yaml`. If either Render service is renamed, update these two values (portal `AEGIS_CONSOLE_URL`, console
`VITE_PORTAL_API_BASE`), redeploy both, and rebuild Aegis so the browser bundle picks up the new portal origin.

The portal keeps its capture on ephemeral storage, so events reset when the free service restarts. The Aegis UI
degrades to “portal offline · last capture” until the service wakes; it retries automatically. Passwords are never
recorded.

## Checks before going live

- `RIVER_API_KEY` is set on the host and **not** committed anywhere.
- `RIVER_API_KEY` is not prefixed with `VITE_`.
- `/api/ai/chat` returns a streamed answer, not a 404 or `index.html`.
- Refreshing a deep link such as `/app/scoring` loads the app, not a host 404.
- `/api/health` reports `aiConfigured: true`.
