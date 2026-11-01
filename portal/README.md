# Northwind decoy portal

A standalone Node service that serves a fictional employee sign-in page and records every attempt the way a real
identity provider would. Aegis Sentinel ingests the capture automatically as the **Northwind portal logins · live**
Logs dataset and flags each failed request individually.

**Demo only.** The accounts, passwords and geolocation values are fictional. Passwords are never stored or sent to
Aegis; only the sign-in metadata is written to `data/`.

## Run locally

From the Aegis repository root (this folder is `portal/`):

```bash
npm run demo      # portal on :4300 and Aegis on :5173
```

or start only the portal:

```bash
npm run portal
```

Open <http://localhost:4300>. The Aegis console uses the Vite proxy at `/api/portal` in development.

## Deploy on Render

When this folder is published as its own repository (for example
[Bloom-247/hakkk](https://github.com/Bloom-247/hakkk)), it is Render-ready:

- `render.yaml` defines a free Node web service named `northwind-decoy-portal`
- start command: `npm start` (`node server.mjs`)
- health check: `/api/health`
- the server binds to `0.0.0.0` and the port Render injects through `PORT`
- CORS is open on the read-only demo endpoints so the Aegis console can poll them

Expected service URL: <https://northwind-decoy-portal.onrender.com>

Set these environment variables in Render:

| variable | purpose |
| --- | --- |
| `AEGIS_CONSOLE_URL` | deployed Aegis origin; the portal links to `/app`, `/app/anomalies` and `/app/uploads` under it |
| `PORT` | supplied by Render automatically |
| `PORTAL_PORT` | local fallback only (defaults to `4300` when `PORT` is absent) |

The Aegis host reads the capture from `https://<service>.onrender.com/api/events?limit=1000` and downloads
`/api/events.csv`. If the Render service name differs, set `VITE_PORTAL_API_BASE` on the Aegis host to the portal
origin and redeploy Aegis.

Captured events live in `data/` on the service's ephemeral filesystem. They reset on restart or redeploy; that is
intentional for a demo. Use **Reset capture** on the portal or in the Aegis Data Input Hub to clear them sooner.

## Endpoints

| method | path | purpose |
| --- | --- | --- |
| `GET` | `/api/health` | service health, capture totals and the Aegis console origin |
| `GET` | `/api/events?limit=1000` | raw capture plus `total`, `failed` and `granted` |
| `GET` | `/api/events.csv` | downloadable event ledger |
| `POST` | `/api/login` | record one sign-in attempt (`email`, `password`, optional `origin`) |
| `POST` | `/api/simulate` | write a scripted ATO or spray burst |
| `POST` | `/api/reset` | clear the capture |
