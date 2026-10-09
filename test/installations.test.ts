import { describe, expect, it, vi } from "vitest";
import {
  applyRepositoryChange,
  parseRepositoryEvent,
  recordInstall,
  removeInstallRepos,
  revokeGithubAuthorization,
  setInstallSuspended,
} from "../src/installations.js";
import deletedFixture from "./fixtures/installation_deleted.json";
import suspendFixture from "./fixtures/installation_suspend.json";
import unsuspendFixture from "./fixtures/installation_unsuspend.json";
import authzFixture from "./fixtures/github_app_authorization.json";
import repoDeletedFixture from "./fixtures/repository_deleted.json";
import repoRenamedFixture from "./fixtures/repository_renamed.json";
import { parseInstallationEvent } from "../src/githubApp.js";

const calls: { op: string; args: unknown }[] = [];

vi.mock("../src/db.js", () => ({
  prisma: {
    installation: {
      upsert: async (args: unknown) => {
        calls.push({ op: "installation.upsert", args });
        return {};
      },
      deleteMany: async (args: unknown) => {
        calls.push({ op: "installation.deleteMany", args });
        return { count: 1 };
      },
    },
    repo: {
      upsert: async (args: unknown) => {
        calls.push({ op: "repo.upsert", args });
        return { id: "r1" };
      },
      findUnique: async (args: { where: { fullName?: string } }) => {
        if (args.where.fullName === "AhadIKK/old-repo") {
          return { id: "r9", installationId: 5n };
        }
        if (args.where.fullName === "AhadIKK/old-name") {
          return { id: "r8", installationId: null };
        }
        return null;
      },
      update: async (args: unknown) => {
        calls.push({ op: "repo.update", args });
        return {};
      },
      updateMany: async (args: unknown) => {
        calls.push({ op: "repo.updateMany", args });
        return { count: 1 };
      },
    },
    user: {
      findUnique: async (args: { where: { githubLogin?: string } }) => {
        calls.push({ op: "user.findUnique", args });
        return args.where.githubLogin === "AhadIKK" ? { id: "u1" } : null;
      },
    },
    userInstallation: {
      upsert: async (args: unknown) => {
        calls.push({ op: "userInstallation.upsert", args });
        return {};
      },
    },
    session: {
      updateMany: async (args: unknown) => {
        calls.push({ op: "session.updateMany", args });
        return { count: 2 };
      },
    },
  },
}));

function reset() {
  calls.length = 0;
}

describe("install lifecycle", () => {
  it("records installs with owner + membership", async () => {
    reset();
    const change = parseInstallationEvent({
      action: "created",
      installation: { id: 5, account: { login: "AhadIKK", type: "User" } },
      repositories: [{ full_name: "AhadIKK/CommitIt" }],
      sender: { login: "AhadIKK" },
    });
    expect(change?.kind).toBe("installed");
    if (!change || change.kind !== "installed") return;
    await recordInstall(change);
    const ops = calls.map((c) => c.op);
    expect(ops).toContain("installation.upsert");
    expect(ops).toContain("repo.upsert");
    expect(ops).toContain("userInstallation.upsert");
    const upsert = calls.find((c) => c.op === "repo.upsert")?.args as {
      create: Record<string, unknown>;
    };
    expect(upsert.create).toMatchObject({ installActive: true });
  });

  it("deletes wipe the install row and deactivate repos", async () => {
    reset();
    const change = parseInstallationEvent(deletedFixture);
    expect(change?.kind).toBe("removed");
    if (!change || change.kind !== "removed") return;
    await removeInstallRepos(change);
    const ops = calls.map((c) => c.op);
    expect(ops).toContain("repo.updateMany");
    expect(ops).toContain("installation.deleteMany");
    const update = calls.find((c) => c.op === "repo.updateMany")?.args as {
      data: Record<string, unknown>;
    };
    expect(update.data).toMatchObject({ installationId: null, installActive: false });
  });

  it("suspend flips inactive, unsuspend flips back", async () => {
    reset();
    const susp = parseInstallationEvent(suspendFixture);
    const uns = parseInstallationEvent(unsuspendFixture);
    expect(susp).toMatchObject({ kind: "suspended" });
    expect(uns).toMatchObject({ kind: "unsuspended" });
    if (!susp || susp.kind !== "suspended" || !uns || uns.kind !== "unsuspended") return;
    await setInstallSuspended(susp.installationId, true);
    await setInstallSuspended(uns.installationId, false);
    const updates = calls.filter((c) => c.op === "repo.updateMany");
    expect(updates).toHaveLength(2);
    expect((updates[0]?.args as { data: unknown }).data).toMatchObject({
      installActive: false,
    });
    expect((updates[1]?.args as { data: unknown }).data).toMatchObject({ installActive: true });
  });

  it("revokes sessions on authorization revoked", async () => {
    reset();
    await expect(revokeGithubAuthorization(authzFixture)).resolves.toBe(2);
    expect(calls.map((c) => c.op)).toContain("session.updateMany");
    await expect(revokeGithubAuthorization({ action: "granted" })).resolves.toBe(0);
    await expect(revokeGithubAuthorization(null)).resolves.toBe(0);
  });

  it("deactivates deleted repos and moves renamed ones", async () => {
    reset();
    const del = parseRepositoryEvent(repoDeletedFixture);
    expect(del).toEqual({ kind: "deleted", fullName: "AhadIKK/old-repo" });
    if (!del) return;
    await expect(applyRepositoryChange(del)).resolves.toBe(true);
    const update = calls.find((c) => c.op === "repo.update")?.args as {
      data: Record<string, unknown>;
    };
    expect(update.data).toMatchObject({ installActive: false, installationId: null });

    reset();
    const ren = parseRepositoryEvent(repoRenamedFixture);
    expect(ren).toEqual({
      kind: "renamed",
      fullName: "AhadIKK/new-name",
      oldFullName: "AhadIKK/old-name",
    });
    if (!ren) return;
    await expect(applyRepositoryChange(ren)).resolves.toBe(true);
    const move = calls.find((c) => c.op === "repo.update")?.args as {
      data: Record<string, unknown>;
    };
    expect(move.data).toMatchObject({ fullName: "AhadIKK/new-name" });

    expect(parseRepositoryEvent({ action: "archived", repository: { full_name: "o/r" } })).toBeNull();
    expect(parseRepositoryEvent({ action: "renamed" })).toBeNull();
  });
});
