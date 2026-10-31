// Backfill `aiSummary` on commits that never got one.
//
// Why this exists: the ingest path only stores a summary when the provider
// returned one (worker.ts:239 deliberately skips degraded results so a row
// never duplicates its own subject). Combined with the upsert's `update`
// branch never touching `aiSummary`, a commit ingested while AI was off stays
// NULL forever — no re-push, no re-delivery, will ever fill it.
//
// It summarises from the stored commit message, exactly like the live path
// (worker.ts:193 passes `diffExcerpt: ""` — webhook payloads carry messages,
// not diffs). So a backfilled row is indistinguishable from one summarised at
// ingest time; this adds no new fidelity and no new behaviour.
//
//   npx tsx scripts/resummarize.ts             # dry run, prints what it would do
//   npx tsx scripts/resummarize.ts --write     # persist
//   npx tsx scripts/resummarize.ts --write --days 3 --limit 100
//
// Scope matters: most rows without a summary predate the AI layer entirely, so
// summarising them rewrites history nobody scrolls to. `--days` bounds the run
// to the gap you actually care about.
//
// Safe to re-run: it only ever selects rows where aiSummary IS NULL.

import "dotenv/config";
import { prisma } from "../src/db.js";
import { summarize } from "../src/brain/summarize.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const limitAt = args.indexOf("--limit");
const limit = limitAt === -1 ? 25 : Math.max(1, Number(args[limitAt + 1]) || 25);
const daysAt = args.indexOf("--days");
const days = daysAt === -1 ? null : Math.max(1, Number(args[daysAt + 1]) || 1);
const since = days === null ? null : new Date(Date.now() - days * 24 * 3600 * 1000);

const provider = (process.env.AI_PROVIDER ?? "echo").toLowerCase();
if (provider === "echo" || !(process.env.AI_API_KEY ?? "").trim()) {
  console.error(`No AI provider configured (AI_PROVIDER=${provider}). Nothing to backfill with.`);
  process.exit(2);
}

const rows = await prisma.commit.findMany({
  where: {
    aiSummary: null,
    isMerge: false,
    secretFlag: false,
    message: { not: "" },
    repo: { aiEnabled: true },
    ...(since ? { createdAt: { gte: since } } : {}),
  },
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
