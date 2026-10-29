export interface InboxThread {
  id: string;
  status: string;
  hasPendingInteraction: boolean;
  isUnread: boolean;
  indicator: string;
  queuedWork: string;
  latestAttentionAt: number;
  isArchived: boolean;
  isHidden: boolean;
}
export interface Entry {
  attention: number;
  reviewed?: number;
  snoozeUntil?: number;
}
export type Ledger = Record<string, Entry>;
export const busy = (t: InboxThread) =>
  ["active", "starting", "stopping"].includes(t.status);
export function reason(t: InboxThread): "input" | "error" | "reply" {
  if (t.hasPendingInteraction) return "input";
  if (
    t.status === "error" ||
    t.queuedWork === "failed" ||
    t.indicator === "unread-error"
  )
    return "error";
  return "reply";
}
export function reconcile(
  ledger: Ledger,
  threads: readonly InboxThread[],
): Ledger {
  const next: Ledger = {};
  for (const t of threads) {
    if (t.isArchived || t.isHidden) continue;
    const old = ledger[t.id];
    if (old) next[t.id] = old;
    if (
      t.hasPendingInteraction ||
      t.queuedWork === "failed" ||
      (t.isUnread && !busy(t))
    ) {
      if (!old || t.latestAttentionAt > old.attention)
        next[t.id] = { attention: t.latestAttentionAt };
    }
  }
  return next;
}
export function needsReview(
  t: InboxThread,
  ledger: Ledger,
  now: number,
): boolean {
  if (t.isArchived || t.isHidden) return false;
  const entry = ledger[t.id];
  if (entry?.snoozeUntil && entry.snoozeUntil > now) return false;
  if (t.hasPendingInteraction || t.queuedWork === "failed") return true;
  if (busy(t)) return false;
  return !!entry && entry.reviewed !== entry.attention;
}
export function parseLedger(raw: string | null): Ledger {
  try {
    const data: unknown = JSON.parse(raw ?? "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data).filter(
        ([id, v]) =>
          id.startsWith("thr_") &&
          v &&
          typeof v === "object" &&
          Number.isFinite(v.attention) &&
          (v.reviewed === undefined || Number.isFinite(v.reviewed)) &&
          (v.snoozeUntil === undefined || Number.isFinite(v.snoozeUntil)),
      ),
    );
  } catch {
    return {};
  }
}

export function applyReview(
  ledger: Ledger,
  t: InboxThread,
  snoozeUntil?: number,
): Ledger {
  const entry = ledger[t.id] ?? { attention: t.latestAttentionAt };
  if (entry.attention > t.latestAttentionAt) return ledger;
  return {
    ...ledger,
    [t.id]:
      snoozeUntil === undefined
        ? { ...entry, reviewed: t.latestAttentionAt, snoozeUntil: undefined }
        : { ...entry, snoozeUntil },
  };
}
