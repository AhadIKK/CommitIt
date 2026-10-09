-- GitHub App installs + GitHub-login accounts. Idempotent: safe to
-- re-apply (IF NOT EXISTS / DROP NOT NULL only loosens constraints).
-- Existing User rows all have telegramUserId, so dropping NOT NULL is safe.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "githubLogin" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "githubUserId" BIGINT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
ALTER TABLE "User" ALTER COLUMN "telegramUserId" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_githubLogin_key" ON "User"("githubLogin");
CREATE UNIQUE INDEX IF NOT EXISTS "User_githubUserId_key" ON "User"("githubUserId");

ALTER TABLE "Repo" ADD COLUMN IF NOT EXISTS "installationId" BIGINT;
ALTER TABLE "Repo" ADD COLUMN IF NOT EXISTS "installedAt" TIMESTAMP(3);
