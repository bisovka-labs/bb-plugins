import { describe, expect, it } from "vitest";
import {
  ago,
  BUILTIN_LIST,
  byProject,
  containsThread,
  lastPromptByThread,
  mergePrompts,
  recentView,
  toggledProvider,
  trackAwaitingReply,
  trackDrafts,
  type RecentNode,
  type ViewThread,
} from "./recent";

const RECENT = "recent-threads/recent";
const HOUR = 3_600_000;
const now = 100 * HOUR;

describe("toggledProvider", () => {
  it("opens Recent and returns to the list shown before", () => {
    expect(toggledProvider(BUILTIN_LIST, RECENT, null)).toBe(RECENT);
    expect(toggledProvider("other/list", RECENT, null)).toBe(RECENT);
    expect(toggledProvider(RECENT, RECENT, "other/list")).toBe("other/list");
  });

  it("falls back to bb's list when nothing usable was saved", () => {
    expect(toggledProvider(RECENT, RECENT, null)).toBe(BUILTIN_LIST);
    expect(toggledProvider(RECENT, RECENT, RECENT)).toBe(BUILTIN_LIST);
    expect(toggledProvider("__automatic__", RECENT, "__automatic__")).toBe(BUILTIN_LIST);
  });
});

describe("prompt history", () => {
  const entry = (id: string, threadId: string, createdAt: number) => ({ id, threadId, createdAt });

  it("merges a fresh page without duplicates and drops entries out of the window", () => {
    const known = [entry("2", "b", now - 2), entry("1", "a", now - 25 * HOUR)];
    const fresh = [entry("4", "a", now), entry("3", "c", now - 1), entry("2", "b", now - 2)];
    expect(mergePrompts(known, fresh, now - 24 * HOUR).map((e) => e.id)).toEqual(["4", "3", "2"]);
  });

  it("keeps each thread's newest prompt", () => {
    const last = lastPromptByThread([entry("3", "a", now - 1), entry("2", "b", now - 2), entry("1", "a", now - 3)]);
    expect([...last]).toEqual([
      ["a", now - 1],
      ["b", now - 2],
    ]);
  });
});

describe("trackDrafts", () => {
  it("keeps first-seen times, stamps new drafts, forgets sent ones", () => {
    expect(trackDrafts({ a: 5, gone: 1 }, new Set(["a", "b"]), 9)).toEqual({ a: 5, b: 9 });
  });
});

function thread(id: string, projectId: string, extra: Partial<ViewThread> = {}): ViewThread {
  return {
    id,
    projectId,
    parentThreadId: null,
    isArchived: false,
    isHidden: false,
    hasPendingInteraction: false,
    indicator: "none",
    updatedAt: 0,
    latestAttentionAt: 0,
    ...extra,
  };
}

const ids = (nodes: RecentNode<ViewThread>[]): unknown[] =>
  nodes.map((node) => (node.children.length ? [node.thread.id, ids(node.children)] : node.thread.id));

function view(
  threads: ViewThread[],
  prompts: Record<string, number>,
  extra: { drafts?: Record<string, number>; awaiting?: Record<string, number>; keep?: string; dismissed?: Record<string, number> } = {},
) {
  return recentView({
    threads,
    lastPrompt: new Map(Object.entries(prompts)),
    draftSeen: extra.drafts ?? {},
    hours: 4,
    now,
    projectNames: new Map([
      ["p1", "Zeta"],
      ["p2", "alpha"],
      ["n10", "10-app"],
      ["n2", "2-web"],
    ]),
    awaitingReply: extra.awaiting ?? {},
    keepWaitingId: extra.keep ?? null,
    dismissedWaiting: extra.dismissed,
  });
}

describe("trackAwaitingReply", () => {
  const live = (id: string, extra: Partial<ViewThread> & { status?: string } = {}) => ({
    ...thread(id, "p1", extra),
    status: extra.status ?? "idle",
  });

  it("remembers waiting threads and keeps them after they are read", () => {
    const first = trackAwaitingReply({}, [live("a", { indicator: "unread-success", latestAttentionAt: 10 })], new Map([["a", 5]]));
    expect(first).toEqual({ a: 10 });
    expect(trackAwaitingReply(first, [live("a")], new Map([["a", 5]]))).toEqual({ a: 10 });
  });

  it("forgets a thread once the user writes in it, a turn starts, or it is archived", () => {
    const seen = { replied: 10, running: 10, archived: 10, gone: 10 };
    const threads = [live("replied"), live("running", { status: "active" }), live("archived", { isArchived: true })];
    expect(trackAwaitingReply(seen, threads, new Map([["replied", 11]]))).toEqual({});
  });

  it("does not re-add dismissed attention, but remembers the next event", () => {
    const first = live("a", { indicator: "waiting-for-input", latestAttentionAt: 10 });
    expect(trackAwaitingReply({ a: 10 }, [first], new Map([["a", 5]]), { a: 10 })).toEqual({});
    const next = { ...first, latestAttentionAt: 20 };
    expect(trackAwaitingReply({}, [next], new Map([["a", 5]]), { a: 10 })).toEqual({ a: 20 });
  });
});

describe("recentView", () => {
  it("dismisses even unread and open waiting threads, and restores them for new attention", () => {
    const waiting = thread("a", "p1", { indicator: "unread-success", latestAttentionAt: now });
    const extra = { dismissed: { a: now }, awaiting: { a: now }, keep: "a" };
    const dismissed = view([waiting], { a: now - 1 }, extra);
    expect(ids(dismissed.waiting)).toEqual([]);
    expect(ids(dismissed.groups[0].threads)).toEqual(["a"]);
    expect(ids(view([{ ...waiting, latestAttentionAt: now + 1 }], { a: now - 1 }, extra).waiting)).toEqual(["a"]);
  });

  it("puts a dismissed waiting subagent back under its parent", () => {
    const result = view(
      [thread("parent", "p1"), thread("child", "p1", { parentThreadId: "parent", hasPendingInteraction: true, latestAttentionAt: now })],
      { parent: now - 1 },
      { dismissed: { child: now }, keep: "child" },
    );
    expect(result.waiting).toEqual([]);
    expect(ids(result.groups[0].threads)).toEqual([["parent", ["child"]]]);
  });
  it("groups by project name, threads newest first, inside the window, without archived", () => {
    const result = view(
      [
        thread("old", "p1"),
        thread("a", "p1"),
        thread("b", "p2"),
        thread("c", "p1"),
        thread("archived", "p2", { isArchived: true }),
        thread("hidden", "p2", { isHidden: true }),
        thread("x", "n10"),
        thread("y", "n2"),
      ],
      { old: now - 5 * HOUR, a: now - 3 * HOUR, b: now - HOUR, c: now - 2 * HOUR, archived: now, hidden: now, x: now, y: now },
    );
    expect(result.groups.map((group) => [group.projectId, ids(group.threads)])).toEqual([
      ["n2", ["y"]],
      ["n10", ["x"]],
      ["p2", ["b"]],
      ["p1", ["c", "a"]],
    ]);
    expect(result.waiting).toEqual([]);
  });

  it("lifts threads waiting for the user to the top group, newest attention first", () => {
    const result = view(
      [
        thread("asks", "p1", { hasPendingInteraction: true, latestAttentionAt: 1 }),
        thread("done", "p2", { indicator: "unread-success", latestAttentionAt: 2 }),
        thread("calm", "p1"),
        thread("stale", "p1", { indicator: "unread-success" }),
      ],
      { asks: now - 1, done: now - 2, calm: now - 3, stale: now - 5 * HOUR },
    );
    expect(ids(result.waiting)).toEqual(["done", "asks"]);
    expect(result.groups.map((group) => ids(group.threads))).toEqual([["calm"]]);
  });

  it("keeps the open thread in the waiting group after it is read", () => {
    const result = view([thread("read", "p1")], { read: now - 1 }, { keep: "read" });
    expect(ids(result.waiting)).toEqual(["read"]);
  });

  it("keeps a read thread the user wrote in waiting until the reply", () => {
    const result = view(
      [thread("unanswered", "p1"), thread("child", "p1", { parentThreadId: "unanswered" })],
      { unanswered: now - 1 },
      { awaiting: { unanswered: now, child: now } },
    );
    // A read subagent the user never wrote in is not lifted on its own.
    expect(ids(result.waiting)).toEqual([["unanswered", ["child"]]]);
    expect(result.groups).toEqual([]);
  });

  it("nests subagents under their recent parent and lifts a waiting one", () => {
    const result = view(
      [
        thread("parent", "p1"),
        thread("child", "p1", { parentThreadId: "parent", updatedAt: 2 }),
        thread("grandchild", "p1", { parentThreadId: "child" }),
        thread("wrote-child", "p1", { parentThreadId: "parent", updatedAt: 1 }),
        thread("asking-child", "p1", { parentThreadId: "parent", hasPendingInteraction: true }),
        thread("orphan-child", "p2", { parentThreadId: "silent" }),
        thread("silent", "p2"),
      ],
      { parent: now - 1, "wrote-child": now - 2 },
    );
    expect(ids(result.waiting)).toEqual(["asking-child"]);
    expect(result.groups.map((group) => ids(group.threads))).toEqual([
      [["parent", ["wrote-child", ["child", ["grandchild"]]]]],
    ]);
  });

  it("includes unsent drafts within the window", () => {
    const result = view([thread("draft", "p1"), thread("old-draft", "p1")], {}, {
      drafts: { draft: now - HOUR, "old-draft": now - 5 * HOUR },
    });
    const [group] = result.groups;
    expect(ids(group.threads)).toEqual(["draft"]);
    expect(group.threads[0]).toMatchObject({ promptAt: null, draftOnly: true });
  });

  it("collects other active threads idle for over a day as stale, newest activity first", () => {
    const result = view(
      [
        thread("recent", "p1"),
        thread("recent-child", "p1", { parentThreadId: "recent" }),
        thread("older", "p2", { updatedAt: 1 }),
        thread("old", "p1", { updatedAt: 2 }),
        thread("old-child", "p1", { parentThreadId: "old" }),
        thread("recent-under-old", "p1", { parentThreadId: "old" }),
        thread("unread-old", "p1", { indicator: "unread-success", updatedAt: 3 }),
        thread("today", "p1", { updatedAt: now - 23 * HOUR }),
        thread("archived", "p1", { isArchived: true }),
        thread("hidden", "p1", { isHidden: true }),
      ],
      { recent: now - 1, "recent-under-old": now - 2, old: now - 5 * HOUR },
    );
    expect(result.groups.map((group) => ids(group.threads))).toEqual([[["recent", ["recent-child"]], "recent-under-old"]]);
    expect(ids(result.stale)).toEqual(["unread-old", ["old", ["old-child"]], "older"]);
  });

  it("finds the open thread anywhere in a tree", () => {
    const [node] = view(
      [thread("parent", "p1"), thread("child", "p1", { parentThreadId: "parent" })],
      { parent: now },
    ).groups[0].threads;
    expect(containsThread(node, "child")).toBe(true);
    expect(containsThread(node, "other")).toBe(false);
  });
});

describe("byProject", () => {
  it("splits waiting threads by project, freshest project first, order kept", () => {
    const node = (id: string, projectId: string) => ({
      thread: { id, projectId },
      promptAt: null,
      draftOnly: false,
      children: [],
    });
    const groups = byProject([node("a1", "a"), node("b1", "b"), node("a2", "a")]);
    expect(groups.map(({ projectId, threads }) => [projectId, threads.map(({ thread }) => thread.id)])).toEqual([
      ["a", ["a1", "a2"]],
      ["b", ["b1"]],
    ]);
  });
});

describe("ago", () => {
  it("formats minutes, hours and days", () => {
    expect(ago(now - 20_000, now)).toBe("сейчас");
    expect(ago(now - 12 * 60_000, now)).toBe("12 мин");
    expect(ago(now - 3 * HOUR - 1, now)).toBe("3 ч");
    expect(ago(now - 50 * HOUR, now)).toBe("2 д");
  });
});
