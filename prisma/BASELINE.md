# Migration baseline decision (2026-10-13)

## Decision: API-applied DDL is the process; `migrate deploy` stays unsupported

`prisma/migrations/` holds five reviewed scripts (`0_init` … `4_link_token_owner`),
but no `_prisma_migrations` history table exists in any database, and neither
deploy target runs `migrate deploy` (Render: install + generate + build; Vercel:
`tsc` + vite). Every schema change to date was applied as raw DDL through the
Supabase Management API instead.

Fabricating `_prisma_migrations` rows by hand was rejected: a wrong checksum or
`applied_steps_count` fails closed the first time anyone runs `migrate status`,
trading a working process for a broken gate. The migration directories remain
the reviewable source of truth; the apply mechanism is documented, not hidden.

## If `migrate deploy` is ever wanted

From any host that can reach the database directly (local dev cannot — direct
host is IPv6-only, pooler TCP hangs; Render can):

1. `npx prisma migrate resolve --applied "0_init"` (repeat for
   `1_telegram_link`, `2_github_app_auth`, `3_install_lifecycle`,
   `4_link_token_owner`, in order — `resolve` computes checksums itself,
   never hand-write them).
2. `npx prisma migrate status` must report up-to-date with no drift.
3. Only then add `prisma migrate deploy` to a build command.

Do NOT create `_prisma_migrations` rows with hand-computed checksums.
