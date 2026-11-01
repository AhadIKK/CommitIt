// Backfill `aiSummary` on commits that never got one.
//
// Why this exists: the ingest path only stores a summary when the provider
// returned one (worker.ts deliberately skips degraded results so a row never
// duplicates its own subject), and the upsert's `update` branch used to ignore
// `aiSummary` entirely — so a commit ingested while AI was off stayed NULL
// forever. No re-push and no re-delivery repaired it.
//
// Two ways to run it:
//
//   --enqueue   hand the work to the job queue, which runs it in the deployment
//               where AI_API_KEY already lives. Nothing leaves that environment
//               and no admin endpoint is exposed. Diffs are fetched, so the
//               result matches a live summary, and a row that introduced a
//               secret is flagged instead of summarised (rule 6).
//
//   default     call the provider from this machine, message-only. Needs a
//               local key; useful for a quick look at what would be written.
//
//   npx tsx scripts/resummarize.ts --enqueue --days 2
//   npx tsx scripts/resummarize.ts                    # dry run, local
//   npx tsx scripts/resummarize.ts --write --days 3
//
// Safe to re-run: the query only ever selects rows where aiSummary IS NULL.

import "dotenv/config";
import { prisma } from "../src/db.js";
import { summarize } from "../src/brain/summarize.js";
import { enqueueJob } from "../src/queue.js";

const args = process.argv.slice(2);
const enqueue = args.includes("--enqueue");
const write = args.includes("--write");
const limitAt = args.indexOf("--limit");
const limit = limitAt === -1 ? 25 : Math.max(1, Number(args[limitAt + 1]) || 25);
const daysAt = args.indexOf("--days");
const days = daysAt === -1 ? null : Math.max(1, Number(args[daysAt + 1]) || 1);
const since = days === null ? null : new Date(Date.now() - days * 24 * 3600 * 1000);

const where = {
  aiSummary: null,
  isMerge: false,
  secretFlag: false,
  message: { not: "" },
  repo: { aiEnabled: true },
  ...(since ? { createdAt: { gte: since } } : {}),
};

if (enqueue) {
  const pending = await prisma.commit.count({ where });
  if (pending === 0) {
    console.log("Nothing to backfill — every eligible commit already has a summary.");
    await prisma.$disconnect();
    process.exit(0);
  }
  // A timestamp keeps each requested run distinct; the queue's idempotency key
  // is what stops a duplicate delivery, not a duplicate intention.
  const deliveryId = `summaries-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await enqueueJob("summaries", deliveryId, {
    since: since?.toISOString(),
    limit,
  });
  console.log(`Queued summaries backfill (${pending} candidate(s), limit ${limit} per run).`);
  console.log(`  deliveryId ${deliveryId}`);
  console.log("  The worker picks it up on the next tick and continues itself while rows remain.");
  await prisma.$disconnect();
  process.exit(0);
}

const provider = (process.env.AI_PROVIDER ?? "echo").toLowerCase();
if (provider === "echo" || !(process.env.AI_API_KEY ?? "").trim()) {
  console.error(`No AI provider configured (AI_PROVIDER=${provider}). Use --enqueue to run it where the key lives.`);
  process.exit(2);
}

const rows = await prisma.commit.findMany({
  where,
  orderBy: { createdAt: "desc" },
  take: limit,
  select: {
    id: true,
    sha: true,
    message: true,
    repoId: true,
    repo: { select: { fullName: true } },
  },
});

console.log(
  `${rows.length} commit(s) without a summary (limit ${limit}${days ? `, last ${days}d` : ""})${write ? "" : " — DRY RUN"}\n`,
);

let filled = 0;
let degraded = 0;

for (const row of rows) {
  const s = await summarize({
    sha: row.sha,
    message: row.message,
    // Local runs are message-only: the diff needs an installation token, which
    // only the deployment has. Use --enqueue for diff-aware backfill.
    diffExcerpt: "",
    aiEnabled: true,
  });

  if (s.degraded) {
    degraded++;
    console.log(`  ${row.sha.slice(0, 7)}  ${row.repo.fullName}  SKIPPED (provider returned nothing)`);
    continue;
  }

  if (write) {
    await prisma.commit.update({ where: { id: row.id }, data: { aiSummary: s.text.slice(0, 2000) } });
  }
  filled++;
  console.log(`  ${row.sha.slice(0, 7)}  ${row.repo.fullName}`);
  console.log(`     ${s.text.slice(0, 150)}`);
}

console.log(
  `\n${write ? "wrote" : "would write"} ${filled}, skipped ${degraded}` +
    (write ? "" : " — re-run with --write to persist"),
);

await prisma.$disconnect();
