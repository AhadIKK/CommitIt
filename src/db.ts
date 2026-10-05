import { PrismaClient } from "@prisma/client";

// Singleton Prisma client. Works against Supabase Postgres via
// DATABASE_URL (pooled) + DIRECT_URL (migrations).
// Local dev without DB reachability: callers must try/catch and degrade.
//
// NOTE: the Vercel Supabase integration reverts manually-added vars it
// manages (notably DATABASE_URL) on every sync/deploy. So the pooled URL
// is also accepted under names the integration never touches — set one of
// these in Vercel instead of fighting DATABASE_URL:
//   COMMITIT_DATABASE_URL (preferred) or POSTGRES_PRISMA_URL / POSTGRES_URL
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.COMMITIT_DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL ??
    "";
}
if (!process.env.DATABASE_URL) {
  console.error(
    "[db] no database URL set (DATABASE_URL, COMMITIT_DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL) — queries will fail and callers must degrade",
  );
}
export const prisma = new PrismaClient();
