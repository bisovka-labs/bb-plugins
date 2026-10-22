// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type TestThreadActionsResolver } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";

const now = Date.now();
afterEach(cleanup);

function thread(id: string, title: string, extra: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id,
    projectId: "proj_a",
    title,
    titleFallback: null,
    displayTitle: title,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/proj_a/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: now - 10_000,
    updatedAt: now - 10_000,
    lastReadAt: null,
    latestAttentionAt: now - 10_000,
    ...extra,
  } as PluginSidebarThread;
}

async function renderList(props: Partial<PluginThreadListProps> = {}, threadActions?: TestThreadActionsResolver) {
  localStorage.clear();
  const app = await loadPluginApp(() => import("./app"));
  const list = app.threadLists[0];
  const rendered = renderSlot(
    list,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate() {}, searchQuery: "", ...props },
    {
      sidebarThreads: {
        status: "ready",
        projects: [{ id: "proj_a", name: "Alpha", isPersonal: false, href: "/p", settingsHref: "/s" }],
        threads: [
          thread("parent", "Parent thread"),
          thread("child", "Subagent", { parentThreadId: "parent" }),
          thread("asks", "Asks a question", { hasPendingInteraction: true, indicator: "waiting-for-input" }),
          thread("draft", "Draft only"),
          thread("old", "Never written", { updatedAt: now - 25 * 3_600_000 }),
          thread("idle-today", "Idle today"),
          thread("archived", "Archived", { isArchived: true }),
        ],
      },
      sidebarDraftThreadIds: ["draft"],
      threadActions,
      sdk: {
        experimental_promptHistory: {
          list: async () =>
            ({
              entries: [
                { id: "e1", threadId: "parent", createdAt: now - 60_000, projectId: "proj_a", scope: "thread", input: [] },
                { id: "e2", threadId: "asks", createdAt: now - 120_000, projectId: "proj_a", scope: "thread", input: [] },
                { id: "e3", threadId: "archived", createdAt: now - 120_000, projectId: "proj_a", scope: "thread", input: [] },
              ],
              nextCursor: null,
            }) as never,
        },
      },
    },
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return rendered;
}

const rowIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-sidebar-thread-id]"), (row) => row.getAttribute("data-sidebar-thread-id"));

describe("Recent list", () => {
  it("leads with waiting threads, nests subagents folded, shows drafts, leaves the rest hanging", async () => {
    await renderList();
    const waiting = screen.getByRole("region", { name: "Ждут тебя" });
    expect(rowIds(waiting)).toEqual(["asks"]);

    const project = screen.getByRole("region", { name: "Alpha" });
    // The draft was first seen just now, so it is newer than the prompt.
    expect(rowIds(project)).toEqual(["draft", "parent"]);
    expect(within(project).getByText("черновик")).toBeTruthy();

    fireEvent.click(within(project).getByRole("button", { name: "Показать подагентов: 1" }));
    expect(rowIds(project)).toEqual(["draft", "parent", "child"]);
    // "Висят" starts folded.
    const stale = screen.getByRole("region", { name: "Висят" });
    expect(rowIds(stale)).toEqual([]);
    expect(within(stale).getByText("1")).toBeTruthy();
    fireEvent.click(within(stale).getByRole("button", { name: "Развернуть Висят" }));
    expect(rowIds(stale)).toEqual(["old"]);
  });

  it("unfolds a parent while its subagent is open", async () => {
    await renderList({ activeThreadId: "child" });
    expect(rowIds(screen.getByRole("region", { name: "Alpha" }))).toEqual(["draft", "parent", "child"]);
  });

  it("archives a row from its quick action", async () => {
    const archived: string[] = [];
    await renderList({}, (target) => [
      {
        key: "bb--core/archive",
        pluginId: "bb--core",
        group: "lifecycle",
        action: { label: "Archive", icon: "Archive", run: async () => void archived.push(target.id) },
      },
      {
        key: "bb--core/pin",
        pluginId: "bb--core",
        group: "organize",
        action: { label: "Pin", icon: "Pin", run: async () => {} },
      },
    ]);
    const project = screen.getByRole("region", { name: "Alpha" });
    expect(within(project).queryAllByRole("button", { name: "Pin" })).toHaveLength(0);
    fireEvent.click(within(project).getAllByRole("button", { name: "Archive" })[1]);
    expect(archived).toEqual(["parent"]);
  });

  it("switches waiting threads between a time list and project sections", async () => {
    await renderList();
    const waiting = screen.getByRole("region", { name: "Ждут тебя" });
    expect(within(waiting).queryByText("Alpha")).toBeNull();
    fireEvent.click(within(waiting).getByRole("radio", { name: "По проектам" }));
    expect(within(waiting).getByText("Alpha")).toBeTruthy();
    expect(rowIds(waiting)).toEqual(["asks"]);
    expect(localStorage.getItem("recent-threads:waiting-by-project")).toBe("1");
    fireEvent.click(within(waiting).getByRole("radio", { name: "По времени" }));
    expect(within(waiting).queryByText("Alpha")).toBeNull();
  });

  it("starts a new thread in a project from its header", async () => {
    let navigated = 0;
    const list = await renderList({ onNavigate: () => void navigated++ });
    expect(screen.queryByRole("button", { name: "Новый тред в Ждут тебя" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Новый тред в Alpha" }));
    expect(navigated).toBe(1);
    expect(list.navigateCalls).toEqual([
      { method: "toCompose", options: { projectId: "proj_a", focusPrompt: true } },
    ]);
  });
});
