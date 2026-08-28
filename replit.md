# Transport Staff Attendance & Salary Management

## Project Overview

A complete web app for managing transport staff attendance, salary, leaves, and advances. PostgreSQL is the shared source of truth; localStorage is retained only as an offline snapshot and retry queue.

## Architecture

- **Stack**: TanStack Start + React 19 + Vite + Bun + Tailwind CSS 4 + shadcn/ui
- **Data**: Replit PostgreSQL via the same-origin `/api/sync` endpoint, with SSE live change notifications and reconnect/focus refresh
- **Auth**: HttpOnly cookie sessions backed by PostgreSQL. Admin uses date-based password (DDMM + SECRET). Workers use biometric (WebAuthn)
- **Port**: 5000 (IPv4 `0.0.0.0`) — Replit does NOT support IPv6 (`::`)

## Key Files

- `src/lib/store.ts` — shared-data cache, optimistic UI, offline snapshots, retry queue, and realtime subscriptions
- `src/routes/api/sync.ts` — authenticated shared snapshot/mutation API and SSE stream
- `server/schema.sql` — development PostgreSQL schema
- `src/lib/biometric.ts` — WebAuthn enroll + verify helpers
- `src/lib/location.ts` — GPS fence (Haversine distance check)
- `src/lib/salary-calc.ts` — pure client-side salary generation
- `src/lib/sheets.ts` — Google Sheets OAuth2 sync (GAPI + GIS)
- `src/routes/worker.tsx` — Worker attendance page (name select → biometric → done)
- `src/routes/_admin/` — Full admin panel (dashboard, employees, attendance, salary, leaves, advances, tempos, godowns, assignments, reports, settings)

## Admin Password Formula

`DDMM + SECRET` where DDMM is today's date and SECRET is stored in localStorage settings (default: "MANOJ").
Example for June 7: `0706MANOJ`

## Worker Flow

1. Worker opens `/worker` on any device
2. Selects their name from list
3. Selects Morning/Evening shift
4. If location is pinned by admin → GPS check happens first
5. Biometric scan (fingerprint/face via WebAuthn)
6. First time = enroll, subsequent = verify
7. Attendance marked ✓

## Google Sheets Setup

1. Create OAuth 2.0 Client ID in Google Cloud Console (Web app type)
2. Go to Settings → enter Client ID → Connect Google Account
3. Create New Sheet or link existing sheet URL
4. Click "Sync Now" to push all data

## Vite Config Note

MUST use `host: "0.0.0.0"` and `port: 5000`. The `@lovable.dev/vite-tanstack-config` package forces `host: "::"` (IPv6) which fails on Replit (EAFNOSUPPORT). Custom vite.config.ts bypasses this package.

## User Preferences

- Hindi/Hinglish language preferred for UI labels
- PostgreSQL-backed shared data with localStorage offline fallback
- Keep admin panel and worker portal separate
