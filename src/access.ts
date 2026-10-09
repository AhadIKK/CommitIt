import { prisma } from "./db.js";
import { getSessionUser, type SessionUser } from "./session.js";

// access.ts — Phase C repo-access gate. A user may read a repo iff the repo
// sits on an ACTIVE installation AND the user owns it or belongs to that
// installation. Repos without an installation (legacy manual webhooks,
// backfills) are denied until the App is installed — narrow by design.

export type AccessDenial = { status: 401 | 403; error: string };

export async function canAccessRepo(userId: string, repoFullName: string): Promise<boolean> {
  try {
    const repo = await prisma.repo.findUnique({
      where: { fullName: repoFullName },
      select: { installationId: true, installActive: true, ownerUserId: true },
    });
    if (!repo || repo.installationId == null || repo.installActive === false) return false;
    if (repo.ownerUserId === userId) return true;
    const member = await prisma.userInstallation.findUnique({
      where: { userId_installationId: { userId, installationId: repo.installationId } },
    });
    return member !== null;
  } catch {
    return false;
  }
}

/** Session check + repo check in one call for the BFF shells. */
export async function checkRepoAccess(
  cookieValue: string | undefined,
  secret: string,
  repoFullName: string,
): Promise<{ user: SessionUser } | { denial: AccessDenial }> {
  const user = await getSessionUser(cookieValue, secret);
  if (!user) return { denial: { status: 401, error: "logged_out" } };
  if (!(await canAccessRepo(user.id, repoFullName))) {
    return { denial: { status: 403, error: "forbidden" } };
  }
  return { user };
}
