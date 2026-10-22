/** Text sent to a thread that a BB restart interrupted. */
export const RESUME_PROMPT = "продолжи";

/** Interruptions older than this are left alone: the work has likely moved on. */
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface ThreadFacts {
  status: string;
  archivedAt: number | null;
  originKind: string | null;
  originPluginId: string | null;
  visibility: string;
}

/** The newest `system/thread/interrupted` or `turn/started` event of the thread. */
export interface LatestEvent {
  id: string;
  type: string;
  createdAt: number;
  data: unknown;
}

/**
 * A thread is resumed when it sits in error, is visible and user-owned, and the
 * newest turn boundary is an interruption caused by the host daemon restarting.
 * Plugin-owned threads (Factory workers and the like) recover on their own.
 */
export function shouldResume(thread: ThreadFacts, latest: LatestEvent | undefined, now: number): boolean {
  if (thread.status !== "error" || thread.archivedAt !== null) return false;
  if (thread.originKind === "plugin" || thread.originPluginId !== null) return false;
  if (thread.visibility !== "visible") return false;
  if (latest?.type !== "system/thread/interrupted") return false;
  if ((latest.data as { reason?: unknown } | null)?.reason !== "host-daemon-restarted") return false;
  return now - latest.createdAt <= MAX_AGE_MS;
}
