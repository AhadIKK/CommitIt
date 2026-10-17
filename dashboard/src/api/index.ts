/**
 * The single place the app learns which adapter it is talking to.
 * Swapping the mock for the real service is this one line.
 */
import type { CommitItApi } from "./client.js";
import { createHttpApi } from "./http.js";
import { createMockApi } from "./mock.js";

/** Flip to true when the endpoints in docs/api-needs.md exist. */
const USE_REAL_API = false;

export const api: CommitItApi = USE_REAL_API ? createHttpApi() : createMockApi();

export type { CommitItApi, DigestPatch, LiveStatus } from "./client.js";
export * from "./types.js";
