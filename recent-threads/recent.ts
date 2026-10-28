// Pure logic of the Recent view: which list the toggle switches to, how the
// prompt history is kept current, and how recent threads become the view.

export const PROVIDER_PREF = "sidebar.threadListProvider";
export const BUILTIN_LIST = "thread-list/thread-list";
export const AUTOMATIC_LIST = "__automatic__";

export const WINDOWS = [1, 4, 12, 24] as const;
export type WindowHours = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: WindowHours = 4;
const HOUR = 3_600_000;
/** A thread with no activity for this long counts as hanging. */
const STALE_AFTER = 24 * HOUR;

/**
 * The provider the toggle sets. From the Recent list it returns to the list
 * shown before; from anything else it opens the Recent list. "Automatic"
 * picks the first non-bundled list, which is the Recent list when it is the
 * only one installed, so it counts as Recent.
 */
export function toggledProvider(current: string, recent: string, previous: string | null): string {
  if (current === recent || current === AUTOMATIC_LIST) {
    return previous && previous !== recent && previous !== AUTOMATIC_LIST ? previous : BUILTIN_LIST;
  }
  return recent;
}

export interface PromptEntry {
  id: string;
  threadId: string;
  createdAt: number;
}

/**
 * Adds a fresh newest-first page run to the known entries (also newest
 * first) and drops what fell out of the window.
 */
export function mergePrompts(
  known: readonly PromptEntry[],
  fresh: readonly PromptEntry[],
  since: number,
): PromptEntry[] {
  const seen = new Set(known.map((entry) => entry.id));
  const added = fresh.filter((entry) => !seen.has(entry.id));
  return [...added, ...known]
    .filter((entry) => entry.createdAt >= since)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Each thread's newest prompt; `entries` come newest first. */
export function lastPromptByThread(entries: readonly PromptEntry[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const entry of entries) {
    if (!last.has(entry.threadId)) last.set(entry.threadId, entry.createdAt);
  }
  return last;
}

/**
 * When each draft was first seen. A draft carries no time of its own, so a
 * draft that is new to this browser counts from `now`; drafts that are gone
 * are forgotten.
 */
export function trackDrafts(
  seen: Readonly<Record<string, number>>,
  draftIds: ReadonlySet<string>,
  now: number,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const id of draftIds) next[id] = seen[id] ?? now;
  return next;
}

export interface ViewThread {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  isArchived: boolean;
  isHidden: boolean;
  hasPendingInteraction: boolean;
  indicator: string;
  updatedAt: number;
  latestAttentionAt: number;
}

const WAITING_INDICATORS = new Set(["waiting-for-input", "unread-success", "unread-error", "queued-failed"]);

/** The agent asked something, failed, or finished a turn the user has not read. */
export function isWaiting(thread: ViewThread): boolean {
  return thread.hasPendingInteraction || WAITING_INDICATORS.has(thread.indicator);
}

/** A dismissal covers this attention event only; a later event can wait again. */
export function isWaitingDismissed(
  thread: ViewThread,
  dismissed: Readonly<Record<string, number>>,
): boolean {
  const at = dismissed[thread.id];
  return at !== undefined && thread.latestAttentionAt <= at;
}

/**
 * Threads that waited for the user and still have no reply, with the time
 * they started waiting. Reading a thread clears its unread mark, but it stays
 * here until the user writes in it (a newer prompt) or a turn starts there;
 * archived and deleted threads are forgotten.
 */
export function trackAwaitingReply(
  seen: Readonly<Record<string, number>>,
  threads: readonly (ViewThread & { status: string })[],
  lastPrompt: ReadonlyMap<string, number>,
  dismissed: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const thread of threads) {
    if (thread.isArchived || thread.isHidden) continue;
    if (isWaitingDismissed(thread, dismissed)) continue;
    if (thread.status === "starting" || thread.status === "active") continue;
    const since = isWaiting(thread) ? (seen[thread.id] ?? thread.latestAttentionAt) : seen[thread.id];
    if (since === undefined || (lastPrompt.get(thread.id) ?? 0) > since) continue;
    next[thread.id] = since;
  }
  return next;
}

export interface RecentNode<T> {
  thread: T;
  /** The user's last prompt; null for a subagent the user never wrote in. */
  promptAt: number | null;
  /** An unsent draft without a later prompt. */
  draftOnly: boolean;
  children: RecentNode<T>[];
}

export interface RecentView<T> {
  /** Threads waiting for the user, across projects, newest attention first. */
  waiting: RecentNode<T>[];
  /** The rest by project; projects by name, threads newest first. */
  groups: { projectId: string; threads: RecentNode<T>[] }[];
  /** Other active threads idle for over a day, across projects, newest activity first. */
  stale: RecentNode<T>[];
  /** Active threads shown nowhere above and idle under a day: the rest of a project in focus. */
  rest: RecentNode<T>[];
}

/**
 * The Recent view: active threads with a prompt or a draft from the user
 * within the last `hours`, with their subagents nested under them. Threads
 * waiting for the user lead in their own group. A thread the user wrote in
 * stays there after it is read while it is in `awaitingReply`; any other
 * thread (a subagent) stays only while it is `keepWaitingId`, the open one,
 * so it does not jump away. Active threads shown nowhere else and idle for
 * over a day end up in `stale`: old sessions left unarchived.
 */
export function recentView<T extends ViewThread>(input: {
  threads: readonly T[];
  lastPrompt: ReadonlyMap<string, number>;
  draftSeen: Readonly<Record<string, number>>;
  hours: number;
  now: number;
  projectNames: ReadonlyMap<string, string>;
  awaitingReply: Readonly<Record<string, number>>;
  keepWaitingId: string | null;
  dismissedWaiting?: Readonly<Record<string, number>>;
}): RecentView<T> {
  const { threads, lastPrompt, draftSeen, hours, now, projectNames, awaitingReply, keepWaitingId } = input;
  const since = now - hours * HOUR;
  const live = threads.filter((thread) => !thread.isArchived && !thread.isHidden);
  const byId = new Map(live.map((thread) => [thread.id, thread]));
  const childrenOf = new Map<string, T[]>();
  for (const thread of live) {
    if (thread.parentThreadId === null || !byId.has(thread.parentThreadId)) continue;
    const siblings = childrenOf.get(thread.parentThreadId) ?? [];
    siblings.push(thread);
    childrenOf.set(thread.parentThreadId, siblings);
  }

  const promptAt = (id: string) => {
    const at = lastPrompt.get(id);
    return at !== undefined && at >= since ? at : null;
  };
  const draftAt = (id: string) => {
    const at = draftSeen[id];
    return at !== undefined && at >= since ? at : null;
  };
  const isRecent = (id: string) => promptAt(id) !== null || draftAt(id) !== null;
  const waits = (thread: T) =>
    !isWaitingDismissed(thread, input.dismissedWaiting ?? {}) && (
      isWaiting(thread) ||
      thread.id === keepWaitingId ||
      (awaitingReply[thread.id] !== undefined && promptAt(thread.id) !== null)
    );
  const sortKey = (node: RecentNode<T>) =>
    node.promptAt ?? (node.draftOnly ? draftAt(node.thread.id) ?? 0 : node.thread.updatedAt);
  const newestFirst = (a: RecentNode<T>, b: RecentNode<T>) => sortKey(b) - sortKey(a);

  /** Nearest ancestor that is recent itself, so this thread nests under it. */
  const recentAncestor = (thread: T) => {
    const visited = new Set([thread.id]);
    let parentId = thread.parentThreadId;
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return null;
      if (isRecent(parent.id)) return parent;
      parentId = parent.parentThreadId;
    }
    return null;
  };

  const node = (thread: T, path: ReadonlySet<string>): RecentNode<T> => {
    const prompt = promptAt(thread.id);
    const nextPath = new Set(path).add(thread.id);
    return {
      thread,
      promptAt: prompt,
      draftOnly: prompt === null && draftAt(thread.id) !== null,
      // Waiting subagents are lifted to the top group instead.
      children: (childrenOf.get(thread.id) ?? [])
        .filter((child) => !path.has(child.id) && !waits(child))
        .map((child) => node(child, nextPath))
        .sort(newestFirst),
    };
  };

  // Recent threads, and subagents of recent threads, that wait for the user.
  const waiting = live
    .filter((thread) => waits(thread) && (isRecent(thread.id) || recentAncestor(thread) !== null))
    .sort((a, b) => b.latestAttentionAt - a.latestAttentionAt)
    .map((thread) => node(thread, new Set()));
  const lifted = new Set(waiting.map(({ thread }) => thread.id));

  const groups = new Map<string, RecentNode<T>[]>();
  for (const thread of live) {
    if (!isRecent(thread.id) || lifted.has(thread.id)) continue;
    // A subagent nests under its recent parent, wherever the parent is shown.
    if (recentAncestor(thread)) continue;
    const list = groups.get(thread.projectId) ?? [];
    list.push(node(thread, new Set()));
    groups.set(thread.projectId, list);
  }
  const name = (projectId: string) => projectNames.get(projectId) ?? projectId;
  const sortedGroups = [...groups.entries()]
    .map(([projectId, list]) => ({ projectId, threads: list.sort(newestFirst) }))
    .sort((a, b) =>
      name(a.projectId).localeCompare(name(b.projectId), undefined, { numeric: true, sensitivity: "base" }),
    );

  const shown = new Set<string>();
  const mark = (node: RecentNode<T>) => {
    shown.add(node.thread.id);
    node.children.forEach(mark);
  };
  waiting.forEach(mark);
  sortedGroups.forEach((group) => group.threads.forEach(mark));
  const byActivity = (a: RecentNode<T>, b: RecentNode<T>) => b.thread.updatedAt - a.thread.updatedAt;
  const staleNode = (thread: T, path: ReadonlySet<string>): RecentNode<T> => {
    const nextPath = new Set(path).add(thread.id);
    return {
      thread,
      promptAt: null,
      draftOnly: false,
      children: (childrenOf.get(thread.id) ?? [])
        .filter((child) => !path.has(child.id) && !shown.has(child.id))
        .map((child) => staleNode(child, nextPath))
        .sort(byActivity),
    };
  };
  const loose = live
    // A subagent nests under its unshown parent; one whose parent is shown above stands alone.
    .filter((thread) => {
      const parentId = thread.parentThreadId;
      return !shown.has(thread.id) && (parentId === null || !byId.has(parentId) || shown.has(parentId));
    })
    .map((thread) => staleNode(thread, new Set()))
    .sort(byActivity);
  const isStale = (node: RecentNode<T>) => node.thread.updatedAt < now - STALE_AFTER;

  return {
    waiting,
    groups: sortedGroups,
    stale: loose.filter(isStale),
    rest: loose.filter((node) => !isStale(node)),
  };
}

/**
 * The waiting threads split by project. Nodes come newest attention first, so
 * the project with the freshest event leads and order inside is kept.
 */
export function byProject<T extends { projectId: string }>(
  nodes: readonly RecentNode<T>[],
): { projectId: string; threads: RecentNode<T>[] }[] {
  const groups = new Map<string, RecentNode<T>[]>();
  for (const node of nodes) {
    const list = groups.get(node.thread.projectId) ?? [];
    list.push(node);
    groups.set(node.thread.projectId, list);
  }
  return [...groups.entries()].map(([projectId, threads]) => ({ projectId, threads }));
}

/**
 * Focus mode: the one thread and every active subagent under it, newest first.
 * Null when the thread is gone, archived or hidden, so focus ends by itself.
 */
export function focusTree<T extends ViewThread>(
  threads: readonly T[],
  id: string,
  lastPrompt: ReadonlyMap<string, number>,
): RecentNode<T> | null {
  const live = threads.filter((thread) => !thread.isArchived && !thread.isHidden);
  const build = (thread: T): RecentNode<T> => ({
    thread,
    promptAt: lastPrompt.get(thread.id) ?? null,
    draftOnly: false,
    children: live
      .filter((child) => child.parentThreadId === thread.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(build),
  });
  const root = live.find((thread) => thread.id === id);
  return root ? build(root) : null;
}

/** A pomodoro on one project: the view shows only it, and exit stays locked until `endsAt`. */
export interface ProjectFocus {
  projectId: string;
  endsAt: number;
}

export const POMODORO_MS = 30 * 60_000;

export function parseProjectFocus(raw: string | null): ProjectFocus | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const { projectId, endsAt } = value as Record<string, unknown>;
    return typeof projectId === "string" && typeof endsAt === "number" ? { projectId, endsAt } : null;
  } catch {
    return null;
  }
}

/** The Recent view narrowed to one project: its waiting threads, every other session, and its stale ones. */
export function projectView<T extends { projectId: string }>(
  view: RecentView<T>,
  projectId: string,
): { waiting: RecentNode<T>[]; threads: RecentNode<T>[]; stale: RecentNode<T>[] } {
  const mine = (node: RecentNode<T>) => node.thread.projectId === projectId;
  return {
    waiting: view.waiting.filter(mine),
    threads: [...(view.groups.find((group) => group.projectId === projectId)?.threads ?? []), ...view.rest.filter(mine)],
    stale: view.stale.filter(mine),
  };
}

/** "29:59" */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whether `id` is this node or one of its descendants. */
export function containsThread<T extends { id: string }>(node: RecentNode<T>, id: string | null): boolean {
  if (id === null) return false;
  return node.thread.id === id || node.children.some((child) => containsThread(child, id));
}

/** "сейчас", "12 мин", "3 ч", "5 д". */
export function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} ч`;
  return `${Math.floor(minutes / (24 * 60))} д`;
}
