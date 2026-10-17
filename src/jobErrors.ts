// jobErrors.ts — how the worker should treat a failed job.
//
// Default is retry: backoff, then try again (a 429 or a flaky network call
// really can succeed later). PermanentJobError marks the cases where retrying
// cannot possibly help — the thing the job operates on is gone (a deleted
// installation, a payload referencing a repo that no longer exists). Those
// jobs are abandoned on the first failure instead of burning every attempt.
//
// Kept dependency-free (no prisma, no queue import) so any module can throw a
// PermanentJobError without dragging in the DB graph or creating a cycle.

export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Pure decision: given a thrown error and the claim count, retry or give up. */
export function jobFailureAction(
  err: unknown,
  attempts: number,
  maxAttempts: number,
): "abandon" | "retry" {
  if (err instanceof PermanentJobError) return "abandon";
  return attempts >= maxAttempts ? "abandon" : "retry";
}
