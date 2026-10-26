/**
 * The single place the app learns which adapter it is talking to.
 *
 * The product talks to the real backend. The mock stays for design review:
 * appending `?state=…` to any URL swaps in the fixtures so every state in the
 * matrix can be looked at on purpose (see lib/scenario.ts), and the Playwright
 * suite runs with VITE_API_MODE=mock so its assertions stay deterministic.
 */
import type { CommitItApi } from "./client.js";
import { createHttpApi } from "./http.js";
import { createMockApi } from "./mock.js";

/** True when the fixtures are answering, i.e. nothing here is a real account. */
export function isReviewMode(): boolean {
  if (import.meta.env.VITE_API_MODE === "mock") return true;
  if (typeof window === "undefined") return false;
  // `?state=` is the review switch: it only means something to the mock.
  return new URLSearchParams(window.location.search).has("state");
}

export const api: CommitItApi = isReviewMode() ? createMockApi() : createHttpApi();

export type { CommitItApi, DigestPatch, LiveStatus } from "./client.js";
export * from "./types.js";
