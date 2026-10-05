-- Telegram chat linking (deep-link tokens + /link codes). Idempotent: safe
-- to re-apply on a DB where Step-1 setup already ran via the API.

CREATE TABLE IF NOT EXISTS "TelegramLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "chatId" TEXT,
    "claimedBy" TEXT,
    "repoFullName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TelegramLink_code_key" ON "TelegramLink"("code");
