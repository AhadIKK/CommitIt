import { PrismaClient } from "@prisma/client";

// Singleton Prisma client. Works against Supabase Postgres via
// DATABASE_URL (pooled) + DIRECT_URL (migrations).
// Local dev without DB reachability: callers must try/catch and degrade.
export const prisma = new PrismaClient();
