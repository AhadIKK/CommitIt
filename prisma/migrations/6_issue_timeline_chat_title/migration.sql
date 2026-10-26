-- Two things the screens already ask for, now stored instead of approximated.
--
-- Issue.closedAt / reopenedAt: the Goal Track draws a reopened task as open
-- again, and "closed since your last digest" needs the moment it closed. Both
-- used to be borrowed from updatedAt, which any later edit moves.
--
-- Chat.title: the Telegram name captured at link time, so Digests can say the
-- group's name instead of "Group chat".
--
-- Idempotent: safe to re-apply (IF NOT EXISTS).

ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "reopenedAt" TIMESTAMP(3);
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "title" TEXT;

-- Issues already closed have no better timestamp than the last write, which is
-- exactly what the API returned before this column existed. Keep that answer
-- instead of reporting them as never closed.
UPDATE "Issue"
SET "closedAt" = "updatedAt"
WHERE "state" = 'closed' AND "closedAt" IS NULL;
