# Deploying Aegis Sentinel

Live deployment: <https://aegis-sentinel-blush.vercel.app> (Vercel project `aegis-sentinel`).

The app is a static Vite build plus one server-side endpoint, `POST /api/ai/chat`, which streams answers from River AI. The endpoint must run on a server: a static-only host would leave the copilot unavailable.

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

## Option 2 — Netlify

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

## Option 3 — Any Node host (Render, Railway, Fly, Docker, VPS)

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

Open the URL, sign in with `admin@aegis.demo` or `analyst@aegis.demo` (demo password `aegis-demo-2026`), then ask the copilot a question. If the reply is a local greeting, the client is working but the server key is missing; check `/api/health`.

## Checks before going live

- `RIVER_API_KEY` is set on the host and **not** committed anywhere.
- `RIVER_API_KEY` is not prefixed with `VITE_`.
- `/api/ai/chat` returns a streamed answer, not a 404 or `index.html`.
- Refreshing a deep link such as `/app/scoring` loads the app, not a host 404.
- `/api/health` reports `aiConfigured: true`.
