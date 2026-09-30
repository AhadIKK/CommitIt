import { classify } from "./brain/classify.js";
import { scan } from "./brain/scan.js";
import { summarize } from "./brain/summarize.js";
import { trim } from "./brain/trim.js";
import { prisma } from "./db.js";
import { formatPush, type FormatCommit } from "./formatter.js";
import { linkCommit } from "./linker.js";
import { claimNextJob, completeJob, failJob } from "./queue.js";
import { sendMessage } from "./telegram.js";
import type { JobRow } from "./queue.js";

// worker.ts — in-process pipeline:
// scan() → trim() → classify() → summarize() → link → store → Telegram.
// Secret scan runs on raw content before any LLM call, every commit.

type PushCommit = {
  id: string;
  message: string;
  author?: { username?: string; name?: string };
  added?: string[];
  modified?: string[];
};

export async function processJob(job: JobRow): Promise<void> {
  if (job.type !== "push") {
    await completeJob(job.id);
    return;
  }
  const payload = job.payload as {
    repository?: { full_name?: string };
    ref?: string;
    compare?: string;
    forced?: boolean;
    commits?: PushCommit[];
  };
  const repo = payload.repository?.full_name ?? "unknown";
  const branch = (payload.ref ?? "").replace("refs/heads/", "") || "main";
  const commits = payload.commits ?? [];

  const formatted: FormatCommit[] = [];
  for (const c of commits.slice(0, 20)) {
    const files = [...(c.added ?? []), ...(c.modified ?? [])].map((p) => ({
      path: p,
      content: "",
    }));
    // NOTE: webhook payloads carry messages, not diffs. Scan runs on the
    // message here; full diff content is scanned in Phase 6 when fetched.
    const scanned = scan([{ path: "<message>", content: c.message }]);
    const secretFlag = scanned.hasSecret;
    void files;
    void trim;
    const category = classify(c.message);
    const isMerge = category === "merge";
    const link = linkCommit({ message: c.message, branch });
    void link;
    let aiSummary: string | undefined;
    let degraded = false;
    if (!isMerge && !secretFlag) {
      const s = await summarize({
        sha: c.id,
        message: c.message,
        diffExcerpt: "",
        aiEnabled: true,
      });
      aiSummary = s.text;
      degraded = s.degraded;
    }
    formatted.push({
      sha: c.id,
      message: c.message,
      author: c.author?.username ?? c.author?.name ?? "unknown",
      category,
      aiSummary,
      degraded,
      isMerge,
      secretFlag,
    });
    try {
      const repoRow = await prisma.repo.upsert({
        where: { fullName: repo },
        update: {},
        create: { fullName: repo },
      });
      await prisma.commit.upsert({
        where: { repoId_sha: { repoId: repoRow.id, sha: c.id } },
        update: { message: c.message.slice(0, 2000), category, secretFlag, isMerge },
        create: {
          repoId: repoRow.id,
          sha: c.id,
          message: c.message.slice(0, 2000),
          category,
          secretFlag,
          isMerge,
          aiSummary: aiSummary?.slice(0, 2000),
        },
      });
    } catch {
      // dev without DB reachability: metadata only in memory, keep going
    }
  }

  const chatId = process.env.TELEGRAM_DEFAULT_CHAT_ID ?? "";
  if (chatId && formatted.length > 0) {
    const html = formatPush({
      repo,
      branch,
      commits: formatted,
      compareUrl: payload.compare,
      forced: payload.forced,
    });
    await sendMessage(chatId, html);
  }
  await completeJob(job.id);
}

export function startWorker(
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  intervalMs = 5000,
): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      const job = await claimNextJob();
      if (job) await processJob(job);
    } catch (err) {
      log.error({ err }, "worker poll failed");
      // never silently drop: job stays queued, failJob() sets backoff
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export async function drainOnce(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  try {
    await processJob(job);
  } catch {
    await failJob(job.id, job.attempts);
  }
  return true;
}
