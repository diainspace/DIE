# DIE — Deterministic Interpretation Engine

Local project: `~/svc/DIE` (Dropbox `@dev/svc/DIE`).

## Current milestone

The interface service exposes `GET /health` and `HEAD /health` on **127.0.0.1:3002**.
A 200 response means the HTTP process is responsive; it does not assert database or Umami readiness.
There is no event ingestion, proxying, database access, or production deployment yet.
No external runtime dependencies are needed for this milestone.

## Run locally

Use Node.js 22 (the VPS major version) or 24 (the current Mac installation).
Keep the private `.env` file owner-only and out of Git. `.env.example` contains placeholders only.

```sh
cd ~/svc/DIE
npm start
```

In another terminal:

```sh
curl http://127.0.0.1:3002/health
```

Expected response:

```json
{"service":"die-interface","status":"ok"}
```

Press Ctrl+C to stop. The service binds only to IPv4 localhost.

## Verification

```sh
npm test
```

The HTTP integration check uses an ephemeral localhost port, no database connections,
and no production data. It checks GET/HEAD health responses, rejected methods, and
unknown routes. It does not test event tracking or database integration.

## Agreed architecture

Websites use their root domain's `analytics.` endpoint, routed to the shared interface
at `analytics.mainops.me`. That layer will identify properties and pages, validate and
normalize observations, infer semantic context, and map Umami's internal IDs.
Umami remains separately hosted at `umami.mainops.me`.

The six canonical attribution fields are `source`, `campaign`, `entry`, `origin`,
`place`, and `dest`. HTML inference follows explicit metadata → semantic structure →
unknown. Capture context without custom cross-domain session tokens or persistent
visitor identification. These behaviors are planned, not implemented in this milestone.

Local PostgreSQL databases are separate: `die_dev` for DIE configuration/rules and
`umami_dev` for development analytics. Production credentials must never be used for
local tests. `UMAMI_DEV_DATABASE_URL` is local setup configuration, not a decision to
bypass Umami's supported interfaces for ingestion.

The operational/design reference is Dropbox
`/___Dev/VPS/Analytics/Analytics_Platform_Record.md`.

## Change Log

- 2026-10-14 — Unversioned document, initial creation: recorded the local health-only
  milestone, startup/verification commands, and boundaries from the agreed architecture.
