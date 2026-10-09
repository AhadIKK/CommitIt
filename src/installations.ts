import { z } from "zod";
import { prisma } from "./db.js";
import { attributeInstallToSender, type InstallationChange } from "./githubApp.js";

// installations.ts — install-lifecycle writes (Phase B). All best-effort at
// the route layer: lifecycle handlers 503 only when the store is down, and
// access loss flips repos.installActive so delivery stops immediately.
// Pure mapping lives in githubApp.parseInstallationEvent (unit-tested);
// this file owns the Prisma writes.

type InstalledChange = Extract<InstallationChange, { kind: "installed" }>;

/** Record an install: Installation row, repo rows (active), owner + member. */
export async function recordInstall(change: InstalledChange): Promise<void> {
  await prisma.installation.upsert({
    where: { id: change.installationId },
    update: {
      accountLogin: change.accountLogin,
      accountType: change.accountType,
      suspendedAt: null,
    },
    create: {
      id: change.installationId,
      accountLogin: change.accountLogin,
      accountType: change.accountType,
    },
  });
  const now = new Date();
  for (const fullName of change.repos) {
    await prisma.repo.upsert({
      where: { fullName },
      update: {
        installationId: change.installationId,
        installedAt: now,
        installActive: true,
      },
      create: {
        fullName,
        installationId: change.installationId,
        installedAt: now,
        installActive: true,
      },
    });
  }
  const userId = await attributeInstallToSender(prisma, {
    installationId: change.installationId,
    repos: change.repos,
    senderLogin: change.senderLogin,
  });
  if (userId) {
    await prisma.userInstallation.upsert({
      where: { userId_installationId: { userId, installationId: change.installationId } },
      update: {},
      create: { userId, installationId: change.installationId },
    });
  }
}

type RemovedChange = Extract<InstallationChange, { kind: "removed" }>;

/**
 * Remove repos from an install. Empty repo list = whole installation deleted:
 * clear every repo on it and drop the Installation row (join rows cascade).
 * Otherwise clear just the listed repos (delete keeps the install alive).
 */
export async function removeInstallRepos(change: RemovedChange): Promise<void> {
  if (change.repos.length > 0) {
    await prisma.repo.updateMany({
      where: { fullName: { in: change.repos }, installationId: change.installationId },
      data: { installationId: null, installActive: false },
    });
    return;
  }
  await prisma.repo.updateMany({
    where: { installationId: change.installationId },
    data: { installationId: null, installActive: false },
  });
  await prisma.installation.deleteMany({ where: { id: change.installationId } });
}

/** Suspend (or unsuspend) an install: flip repos.installActive, keep rows. */
export async function setInstallSuspended(
  installationId: bigint,
  suspended: boolean,
): Promise<void> {
  await prisma.installation.upsert({
    where: { id: installationId },
    update: { suspendedAt: suspended ? new Date() : null },
    create: { id: installationId, suspendedAt: suspended ? new Date() : null },
  });
  await prisma.repo.updateMany({
    where: { installationId },
    data: { installActive: !suspended },
  });
}

const AuthorizationSchema = z.object({
  action: z.string(),
  sender: z.object({ login: z.string() }).optional(),
});

/**
 * Handle github_app_authorization.revoked: revoke every live session of the
 * GitHub user so a deauthorized account goes dark immediately. Returns the
 * number of sessions revoked (0 when unknown action/user).
 */
export async function revokeGithubAuthorization(body: unknown): Promise<number> {
  const parsed = AuthorizationSchema.safeParse(body);
  if (!parsed.success) return 0;
  if (parsed.data.action !== "revoked") return 0;
  const login = parsed.data.sender?.login;
  if (!login) return 0;
  try {
    const user = await prisma.user.findUnique({ where: { githubLogin: login } });
    if (!user) return 0;
    const res = await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  } catch {
    return 0;
  }
}
