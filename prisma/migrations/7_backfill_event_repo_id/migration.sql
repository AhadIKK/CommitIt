-- One-time repair: deliveries were stored without the repository they belong to,
-- so webhook health had nothing to read and every repo reported "no delivery
-- yet". The payload is still on the matching job, so the link can be rebuilt.
--
-- Idempotent: only touches rows that are still NULL.

UPDATE "Event" e
SET "repoId" = r."id"
FROM "Job" j
JOIN "Repo" r
  ON lower(r."fullName") = lower(j."payload"->'repository'->>'full_name')
WHERE j."deliveryId" = e."deliveryId"
  AND e."repoId" IS NULL;
