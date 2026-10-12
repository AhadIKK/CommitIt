-- Bind deep-link tokens to the issuing website account so /start can join
-- the Telegram sender to their GitHub-linked CommitIt account.
-- Idempotent: safe to re-apply (IF NOT EXISTS).

ALTER TABLE "LinkToken" ADD COLUMN IF NOT EXISTS "githubLogin" TEXT;
