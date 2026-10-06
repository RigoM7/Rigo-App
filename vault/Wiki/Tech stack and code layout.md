---
type: topic
updated: 2026-10-06
sources: ["[[repo README (2026-10-06)]]", "[[repo CLAUDE (2026-10-06)]]"]
---
# Tech stack and code layout

| Layer | Choice |
|---|---|
| Web | React 19, React Router 7, TanStack Query, Vite, plain CSS tokens, Lucide, Geist / Geist Mono |
| API | Hono on Node.js 22 (TypeScript), zod validation |
| Auth | Own sessions (see [[Accounts, sign-in and recovery]]) |
| Database | PostgreSQL 16+ via `pg`; embedded **PGlite** in `./data/db` when there's no `DATABASE_URL` |
| Migrations | Ordered SQL files in `migrations/`, applied automatically under an advisory lock. Never edit an applied one. |
| Files | Local disk or database storage (`STORAGE_DRIVER=database` on Vercel) |
| Background work | Durable `events → automation_runs → actions → approvals` tables |
| Tests | Vitest (API/domain, PGlite or PostgreSQL) and Playwright browser checks (`e2e/run.mjs`) |

## Where things live
```
src/shared/   business rules shared by server and client: permissions, pricing math, job states,
              workflow definitions/validation/simulation, schedules, branding contrast, password rule
src/server/   http/ (app, auth context, errors) · modules/ (one router per area) ·
              automation/ (engine + action primitives) · adapters/ (email, AI, storage) · db/
src/client/   components/ (UI kit, shell, timeline) · pages/ · lib/ (api, session, offline drafts, theme)
migrations/   SQL schema "rigo" (001_init, 002_account_recovery)
test/         API and domain tests
e2e/run.mjs   browser checks
```

## Run and check
- `npm install && npm run build && npm start` → http://localhost:8787 (no database server or keys needed).
- `npm run dev` for hot reload (web on :5173).
- `npm run typecheck`, `npm test`, then `npm run build && npm start &` and `NODE_PATH=$(npm root -g) npm run test:browser`.

## Related
- [[Deployment and data]] · [[Working with Claude on Rigo]]
