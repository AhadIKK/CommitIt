import { describe, expect, it } from "vitest";
import { needsConnectWizard, type ConnectVisitor } from "./connect.js";

const visitor: ConnectVisitor = {
  signedIn: false,
  repoCount: 0,
  repoScoped: false,
  reviewMode: false,
};

describe("needsConnectWizard", () => {
  it("keeps a signed-out visitor in the wizard", () => {
    expect(needsConnectWizard(visitor)).toBe(true);
  });

  it("keeps a signed-in account that cannot see a repository yet", () => {
    expect(needsConnectWizard({ ...visitor, signedIn: true })).toBe(true);
  });

  it("sends a set-up account to the dashboard", () => {
    expect(needsConnectWizard({ ...visitor, signedIn: true, repoCount: 2 })).toBe(false);
  });

  it("keeps a set-up account in the wizard when it asked for one repository", () => {
    expect(
      needsConnectWizard({ ...visitor, signedIn: true, repoCount: 2, repoScoped: true }),
    ).toBe(true);
  });

  it("never redirects in review mode, so the wizard stays reviewable", () => {
    expect(
      needsConnectWizard({ ...visitor, signedIn: true, repoCount: 2, reviewMode: true }),
    ).toBe(true);
  });
});
