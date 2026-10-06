---
type: topic
updated: 2026-10-06
sources: ["[[repo README (2026-10-06)]]", "[[repo CLAUDE (2026-10-06)]]", "[[PR 08 Rebuild Rigo as a new application]]", "[[PR 07 Always build main so the PR 6 release deploys]]"]
---
# Deployment and data

## Vercel
- Project `rigo-app`, team `rigo9`. Live: https://rigo-app-dun.vercel.app
- `npm run build` also writes `.vercel/output` (Build Output API v3): static web app plus one Node.js function (`scripts/vercel-output.mjs`).
- Deployments are limited, so work is batched: one branch, one PR, one push.
- `ignoreCommand` skips builds for commits that only touch `.claude/`, `CLAUDE.md` or `vault/`, and, on branches other than `main`, commits whose first line contains `[checkpoint]`. `main` always builds.
- No always-on process: automation runs at the end of state-changing requests and in a daily cron (`/api/cron/tick`, protected by `CRON_SECRET`).

## Supabase
- Project `rigo-app` (`dlksigvhqxpoqarpltev`), schema **`rigo` only**, which the public API roles can't access.
- Accessed by the dedicated `rigo_app` login through `DATABASE_URL` (transaction pooler, port 6543, `aws-0-us-east-1`), set in Vercel for production and preview.
- Migrations run on the first request. The first migration created 40 tables.
- The old `public.rigo_*` tables belong to the previous app and are unused.

## Environment variables
`DATABASE_URL`, `APP_URL`, `STORAGE_DRIVER`, `RIGO_DEV_MAILBOX`, `RIGO_AI_PROVIDER` / `ANTHROPIC_API_KEY` / `RIGO_AI_MODEL` / `RIGO_AI_DAILY_LIMIT`, `CRON_SECRET`, `RIGO_SUPPORT_EMAIL`, `RIGO_TERMS_URL` / `RIGO_PRIVACY_URL`, `RIGO_EMAIL_PROVIDER`, `RIGO_TRUST_PROXY`. All optional except `DATABASE_URL` on Vercel. See `.env.example`.

## Related
- [[Tech stack and code layout]] · [[Open questions]]
