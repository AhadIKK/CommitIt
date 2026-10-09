-- Phase B install lifecycle: installations, user_installations, sessions
-- (hash-only), link_tokens (hash-only), repo install/sync columns.
-- Idempotent: safe to re-apply (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS "Installation" (
    "id" BIGINT NOT NULL,
    "accountLogin" TEXT,
    "accountType" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserInstallation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInstallation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserInstallation_userId_installationId_key"
    ON "UserInstallation"("userId", "installationId");

ALTER TABLE "UserInstallation" DROP CONSTRAINT IF EXISTS "UserInstallation_userId_fkey";
ALTER TABLE "UserInstallation"
    ADD CONSTRAINT "UserInstallation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserInstallation" DROP CONSTRAINT IF EXISTS "UserInstallation_installationId_fkey";
ALTER TABLE "UserInstallation"
    ADD CONSTRAINT "UserInstallation_installationId_fkey"
    FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");

ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_userId_fkey";
ALTER TABLE "Session"
    ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LinkToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "chatId" TEXT,
    "repoFullName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LinkToken_tokenHash_key" ON "LinkToken"("tokenHash");

ALTER TABLE "Repo" ADD COLUMN IF NOT EXISTS "installActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Repo" ADD COLUMN IF NOT EXISTS "syncEtag" TEXT;
ALTER TABLE "Repo" ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(3);
