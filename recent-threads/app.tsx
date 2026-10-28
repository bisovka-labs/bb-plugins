import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useProviders,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  experimental_useThreadActions,
  ThreadTitle,
  useBbNavigate,
  useSdk,
  useSidebarThreadDraft,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginBrowserBbSdk,
  type PluginProvidersState,
  type PluginSidebarThread,
  type PluginThreadActionTarget,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ago,
  byProject,
  containsThread,
  countdown,
  DEFAULT_WINDOW,
  focusTree,
  isWaiting,
  isWaitingDismissed,
  lastPromptByThread,
  mergePrompts,
  parseProjectFocus,
  POMODORO_MS,
  projectRanks,
  projectView,
  PROVIDER_PREF,
  recentView,
  toggledProvider,
  trackAwaitingReply,
  trackDrafts,
  WINDOWS,
  type ProjectFocus,
  type PromptEntry,
  type RecentNode,
  type WindowHours,
} from "./recent";
import { AWAITING_KEY, DISMISSED_KEY, readTimes, useTimes, writeTimes } from "./waiting-state";

const PLUGIN_ID = "recent-threads";
const LIST_ID = "recent";
const RECENT_LIST = `${PLUGIN_ID}/${LIST_ID}`;
const PREVIOUS_KEY = `${PLUGIN_ID}:previous-list`;
const WINDOW_KEY = `${PLUGIN_ID}:window-hours`;
const COLLAPSED_KEY = `${PLUGIN_ID}:collapsed-projects`;
const EXPANDED_KEY = `${PLUGIN_ID}:expanded-threads`;
const DRAFTS_KEY = `${PLUGIN_ID}:draft-seen`;
const WAITING_SORT_KEY = `${PLUGIN_ID}:waiting-by-project`;
const FOCUS_KEY = `${PLUGIN_ID}:focus`;
const PROJECT_FOCUS_KEY = `${PLUGIN_ID}:project-focus`;
/** bb's own list shows Archive as a row's quick action by default. */
const ROW_ACTIONS = ["bb--core/archive"];
/** The collapse key of the "waiting for you" group. */
const WAITING_GROUP = "__waiting__";
const HOUR = 3_600_000;
/** The prompt history read covers the widest window, so switching is instant. */
const HISTORY_SPAN = Math.max(...WINDOWS) * HOUR;
const HISTORY_PAGE = 50;
const HISTORY_MAX_PAGES = 10;

// The footer action runs outside React; an app overlay hands it the SDK.
let appSdk: PluginBrowserBbSdk | null = null;

function SdkBridge() {
  appSdk = useSdk();
  return null;
}

/** Switches the sidebar between the Recent list and the list shown before it. */
async function toggleList(sdk: PluginBrowserBbSdk | null = appSdk) {
  if (!sdk) return;
  // A running pomodoro keeps the sidebar on its project.
  const pomodoro = parseProjectFocus(localStorage.getItem(PROJECT_FOCUS_KEY));
  if (pomodoro && pomodoro.endsAt > Date.now()) {
    toast("Фокус на проекте", { description: `Ещё ${countdown(pomodoro.endsAt - Date.now())} до конца помодоро.` });
    return;
  }
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { preferences } = await sdk.system.uiPreferences.list();
      const { value: current, revision } = preferences[PROVIDER_PREF];
      const next = toggledProvider(current, RECENT_LIST, localStorage.getItem(PREVIOUS_KEY));
      if (next === RECENT_LIST) localStorage.setItem(PREVIOUS_KEY, current);
      try {
        await sdk.system.uiPreferences.set({ key: PROVIDER_PREF, value: next, expectedRevision: revision });
        return;
      } catch (error) {
        // Another window changed it first: read again and retry.
        if ((error as { status?: number }).status !== 409) throw error;
      }
    }
  } catch (error) {
    toast.error("Не удалось переключить список тредов", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

function useWindowHours(): [WindowHours, (hours: WindowHours) => void] {
  const [hours, setHours] = useState<WindowHours>(() => {
    const stored = Number(localStorage.getItem(WINDOW_KEY));
    return (WINDOWS as readonly number[]).includes(stored) ? (stored as WindowHours) : DEFAULT_WINDOW;
  });
  const choose = useCallback((next: WindowHours) => {
    localStorage.setItem(WINDOW_KEY, String(next));
    setHours(next);
  }, []);
  return [hours, choose];
}

/** A set of ids kept in localStorage, per browser. */
function useStoredSet(key: string): [ReadonlySet<string>, (id: string) => void] {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback(
    (id: string) => {
      setIds((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        localStorage.setItem(key, JSON.stringify([...next]));
        return next;
      });
    },
    [key],
  );
  return [ids, toggle];
}

/** When this browser first saw each unsent draft, so drafts age out of the window. */
function useDraftSeen(): Readonly<Record<string, number>> {
  const draftIds = useSidebarThreadDraftIds();
  const [seen, setSeen] = useState<Readonly<Record<string, number>>>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
      return stored && typeof stored === "object" ? (stored as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    setSeen((current) => {
      const next = trackDrafts(current, draftIds, Date.now());
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(next));
      return next;
    });
  }, [draftIds]);
  return seen;
}

/** Threads still waiting for the user's reply after being read, per browser. */
function useAwaitingReply(
  threads: readonly PluginSidebarThread[],
  status: string,
  lastPrompt: ReadonlyMap<string, number> | null,
  dismissed: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const awaiting = useTimes(AWAITING_KEY);
  useEffect(() => {
    // Without the full thread list or the prompts, a reply cannot be told apart.
    if (status !== "ready" || !lastPrompt) return;
    const next = trackAwaitingReply(awaiting, threads, lastPrompt, dismissed);
    if (JSON.stringify(next) !== JSON.stringify(awaiting))
      writeTimes(AWAITING_KEY, next);
  }, [threads, status, lastPrompt, dismissed, awaiting]);
  return awaiting;
}

/** Re-renders every minute, so relative times and the window edge move. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The clock each second while `active`, for the pomodoro countdown. */
function useSecondTick(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** The pomodoro on one project, kept in this browser. */
function useProjectFocus() {
  const [focus, setFocus] = useState(() => parseProjectFocus(localStorage.getItem(PROJECT_FOCUS_KEY)));
  const save = useCallback((next: ProjectFocus | null) => {
    if (next) localStorage.setItem(PROJECT_FOCUS_KEY, JSON.stringify(next));
    else localStorage.removeItem(PROJECT_FOCUS_KEY);
    setFocus(next);
  }, []);
  return [focus, save] as const;
}

/**
 * Bumps when the user has probably just sent a prompt: a thread started a
 * turn, or a new thread appeared. Ordinary agent progress does not bump it.
 */
function usePromptSignal(threads: readonly PluginSidebarThread[]) {
  const [signal, setSignal] = useState(0);
  const previous = useRef<{ busy: Set<string>; known: Set<string> } | null>(null);
  useEffect(() => {
    const busy = new Set(
      threads.filter((thread) => thread.status === "starting" || thread.status === "active").map((t) => t.id),
    );
    const known = new Set(threads.map((thread) => thread.id));
    const before = previous.current;
    previous.current = { busy, known };
    if (!before) return;
    const started = [...busy].some((id) => !before.busy.has(id));
    const created = [...known].some((id) => !before.known.has(id));
    if (started || created) setSignal((count) => count + 1);
  }, [threads]);
  return signal;
}

/**
 * Each thread's newest prompt from the user over the last day, read from bb's
 * prompt history. The first read covers the day; later reads fetch only the
 * newest page until they reach a known entry. Reads on `signal`, on focus,
 * and once a minute.
 */
function useLastPrompts(sdk: PluginBrowserBbSdk, signal: number) {
  const [lastPrompt, setLastPrompt] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entries = useRef<PromptEntry[] | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const since = Date.now() - HISTORY_SPAN;
      const known = entries.current;
      const knownIds = new Set(known?.map((entry) => entry.id));
      const fresh: PromptEntry[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
        const result = await sdk.experimental_promptHistory.list({ limit: String(HISTORY_PAGE), cursor });
        fresh.push(...result.entries);
        const oldest = result.entries.at(-1)?.createdAt ?? 0;
        const reachedKnown = result.entries.some((entry) => knownIds.has(entry.id));
        if (!result.nextCursor || oldest < since || reachedKnown) break;
        cursor = result.nextCursor;
      }
      const merged = mergePrompts(known ?? [], fresh, since);
      entries.current = merged;
      setLastPrompt(lastPromptByThread(merged));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
    }
  }, [sdk]);

  useEffect(() => {
    // The prompt reaches the history a moment after the turn starts.
    const timer = setTimeout(refresh, signal === 0 ? 0 : 1_000);
    return () => clearTimeout(timer);
  }, [refresh, signal]);

  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { lastPrompt, error };
}

function actionTarget(thread: PluginSidebarThread): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: thread.environment?.id
      ? { id: thread.environment.id, path: thread.environment.path }
      : null,
  };
}

type Provider = PluginProvidersState["providers"][number];

interface RowContext {
  activeThreadId: string | null;
  now: number;
  providers: readonly Provider[];
  expanded: ReadonlySet<string>;
  toggleExpanded(threadId: string): void;
  focusedId: string | null;
  toggleFocus(threadId: string): void;
  onNavigate(): void;
}

/** Lucide "Focus": a dot in a frame of corners. */
function FocusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}

/** New-thread and focus buttons on a project label, shown on hover of `group`. */
function ProjectButtons({
  name,
  onNewThread,
  onFocus,
  hoverGroup,
}: {
  name: string;
  onNewThread?: () => void;
  onFocus?: () => void;
  hoverGroup: "group" | "section";
}) {
  const className = cn(
    "flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground opacity-0 outline-none ring-sidebar-ring hover:bg-state-hover hover:text-muted-foreground focus-visible:opacity-100 focus-visible:ring-2 max-md:pointer-coarse:opacity-100",
    hoverGroup === "group" ? "group-hover/group:opacity-100" : "group-hover/section:opacity-100",
  );
  return (
    <>
      {onFocus && (
        <button
          type="button"
          aria-label={`Фокус на ${name}`}
          title={`Фокус на ${name}: помодоро 30 мин`}
          onClick={onFocus}
          className={className}
        >
          <FocusIcon className="size-4" />
        </button>
      )}
      {onNewThread && (
        <button
          type="button"
          aria-label={`Новый тред в ${name}`}
          title={`Новый тред в ${name}`}
          onClick={onNewThread}
          className={className}
        >
          <Icon name="MessageSquarePlus" className="size-4" aria-hidden />
        </button>
      )}
    </>
  );
}

function ThreadRow({
  thread,
  label,
  depth,
  childCount,
  isExpanded,
  context,
}: {
  thread: PluginSidebarThread;
  label: string;
  depth: number;
  childCount: number;
  isExpanded: boolean;
  context: RowContext;
}) {
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const target = useMemo(() => actionTarget(thread), [thread]);
  const quickActions = experimental_useThreadActions(target, { keys: ROW_ACTIONS });
  // Dragging the row out of the sidebar opens it in a split, as in bb's own list.
  const split = experimental_useSidebarThreadSplit(thread.id);
  const navigate = useBbNavigate();
  const provider = context.providers.find((candidate) => candidate.id === thread.providerId);
  const isActive = thread.id === context.activeThreadId;
  const isFocused = thread.id === context.focusedId;
  const indicator =
    thread.indicator === "none" && hasUnsubmittedDraft ? "draft" : thread.indicator;

  return (
    <ThreadActionsContextMenu thread={target}>
      <div
        // bb's row markers, so a theme that restyles bb's rows restyles these too.
        data-sidebar-rename-row=""
        {...split.splitProps}
        style={{ paddingLeft: 8 + depth * 16 }}
        className={cn(
          "bb-sidebar-hover-actions-row group/row relative flex h-[var(--bb-sidebar-row-height)] w-full select-none items-center gap-1.5 rounded-md pr-0 text-sm max-md:pointer-coarse:h-[var(--bb-sidebar-row-height-coarse)]",
          isActive
            ? "bb-sidebar-selected-row bg-state-active"
            : "bb-sidebar-accent-row hover:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent",
        )}
      >
        <a
          href={thread.href}
          draggable={false}
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          aria-label={thread.displayTitle}
          aria-current={isActive ? "page" : undefined}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          onClick={(event) => {
            if (split.isAvailable && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              navigate.toThread(thread.id, { split: true });
              return;
            }
            context.onNavigate();
          }}
          className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
        />
        <span className="pointer-events-none relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {indicator === "none" && !rowStatus ? (
            // An idle row shows its agent, as bb's own list does.
            <ProviderIcon
              providerKind="agent"
              provider={provider ?? { id: thread.providerId }}
              className="size-4"
              aria-hidden
            />
          ) : (
            <ThreadStatusGlyph indicator={indicator} rowStatus={rowStatus} />
          )}
        </span>
        <span className="pointer-events-none relative min-w-0 flex-1 truncate whitespace-pre">
          <ThreadTitle threadId={thread.id} />
        </span>
        {childCount > 0 && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Скрыть" : "Показать"} подагентов: ${childCount}`}
            onClick={() => context.toggleExpanded(thread.id)}
            className="relative flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1 text-xs tabular-nums text-subtle-foreground outline-none ring-sidebar-ring hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2"
          >
            {childCount}
            <Icon
              name="ChevronRight"
              className={cn("size-3 transition-transform duration-150", isExpanded && "rotate-90")}
              aria-hidden
            />
          </button>
        )}
        <span className="pointer-events-none relative shrink-0 pr-1 text-xs tabular-nums text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden">
          {shortcut?.label ?? label}
        </span>
        <button
          type="button"
          aria-pressed={isFocused}
          aria-label={isFocused ? "Выйти из фокуса" : "Фокус на этом треде"}
          title={isFocused ? "Выйти из фокуса" : "Фокус: скрыть остальные треды"}
          onClick={() => context.toggleFocus(thread.id)}
          className={cn(
            "relative size-6 shrink-0 items-center justify-center rounded-md outline-none ring-sidebar-ring hover:bg-state-hover focus-visible:flex focus-visible:ring-2 group-hover/row:flex group-focus-within/row:flex",
            isFocused
              ? "flex text-sidebar-accent-foreground"
              : "hidden text-subtle-foreground hover:text-muted-foreground",
          )}
        >
          <FocusIcon className="size-4" />
        </button>
        {quickActions.map(({ key, action }) => (
          <button
            key={key}
            type="button"
            aria-label={action.label}
            title={action.label}
            disabled={action.disabled}
            onClick={() => void action.run()}
            className="relative hidden size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring hover:bg-state-hover hover:text-muted-foreground focus-visible:flex focus-visible:ring-2 group-hover/row:flex group-focus-within/row:flex"
          >
            <Icon name={action.icon} className="size-4" aria-hidden />
          </button>
        ))}
        <ThreadActionsMenu
          thread={target}
          align="start"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              aria-label={`Действия: ${thread.displayTitle}`}
              className={cn(
                props.className,
                "relative hidden size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-muted-foreground focus-visible:flex group-hover/row:flex group-focus-within/row:flex data-[state=open]:flex",
              )}
            >
              <Icon name="MoreHorizontal" className="size-4" aria-hidden />
            </button>
          )}
        />
      </div>
    </ThreadActionsContextMenu>
  );
}

/** A thread and, when unfolded or holding the open thread, its subagents. */
function ThreadTree({
  node,
  depth,
  label,
  context,
}: {
  node: RecentNode<PluginSidebarThread>;
  depth: number;
  label: (node: RecentNode<PluginSidebarThread>) => string;
  context: RowContext;
}) {
  const isExpanded =
    context.expanded.has(node.thread.id) ||
    node.children.some((child) => containsThread(child, context.activeThreadId));
  return (
    <>
      <ThreadRow
        thread={node.thread}
        label={label(node)}
        depth={depth}
        childCount={node.children.length}
        isExpanded={isExpanded}
        context={context}
      />
      {isExpanded &&
        node.children.map((child) => (
          <ThreadTree key={child.thread.id} node={child} depth={depth + 1} label={label} context={context} />
        ))}
    </>
  );
}

/** A group label in bb's own style, folding the threads under it. */
function Group({
  name,
  count,
  isCollapsed,
  onToggle,
  onNewThread,
  onFocus,
  actions,
  nodes,
  sections,
  label,
  context,
}: {
  name: string;
  /** Shown next to the name. */
  count?: number;
  isCollapsed: boolean;
  onToggle(): void;
  /** Starts a new thread in the group's project; the waiting group has none. */
  onNewThread?: () => void;
  /** Starts a pomodoro focus on the group's project. */
  onFocus?: () => void;
  /** Extra buttons on the right of the header, shown on hover. */
  actions?: ReactNode;
  nodes: RecentNode<PluginSidebarThread>[];
  /** Splits the nodes under sub-labels: the waiting group by project. */
  sections?: {
    key: string;
    name: string;
    nodes: RecentNode<PluginSidebarThread>[];
    onNewThread?: () => void;
    onFocus?: () => void;
  }[];
  label: (node: RecentNode<PluginSidebarThread>) => string;
  context: RowContext;
}) {
  // A folded group still shows the open thread, so it never disappears.
  const fold = (list: RecentNode<PluginSidebarThread>[]) =>
    isCollapsed ? list.filter((node) => containsThread(node, context.activeThreadId)) : list;
  const visible = fold(nodes);
  const rows = (list: RecentNode<PluginSidebarThread>[]) =>
    list.map((node) => (
      <ThreadTree key={node.thread.id} node={node} depth={0} label={label} context={context} />
    ));
  return (
    <section aria-label={name}>
      <div className="group/group flex items-center">
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? "Развернуть" : "Свернуть"} ${name}`}
          onClick={onToggle}
          className="group/header flex h-6 min-w-0 flex-1 select-none items-center gap-1 rounded-md pl-2 text-left text-xs font-normal leading-5 text-muted-foreground outline-none ring-sidebar-ring focus-visible:ring-2"
        >
          <span className="min-w-0 truncate">{name}</span>
          {count !== undefined && <span className="shrink-0 tabular-nums text-subtle-foreground">{count}</span>}
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground group-hover/header:text-muted-foreground",
              !isCollapsed && "opacity-0 group-hover/header:opacity-100 group-focus-visible/header:opacity-100",
            )}
          >
            <Icon
              name="ChevronRight"
              className={cn("size-3 transition-transform duration-150", !isCollapsed && "rotate-90")}
              aria-hidden
            />
          </span>
        </button>
        <ProjectButtons name={name} onNewThread={onNewThread} onFocus={onFocus} hoverGroup="group" />
        {actions}
      </div>
      {visible.length > 0 &&
        (sections ? (
          sections.map((section) => {
            const shown = fold(section.nodes);
            return (
              shown.length > 0 && (
                <div key={section.key} className="mt-1 first:mt-0">
                  <div className="group/section flex items-center">
                    <div className="min-w-0 flex-1 truncate pl-2 text-[11px] leading-5 text-subtle-foreground">
                      {section.name}
                    </div>
                    <ProjectButtons
                      name={section.name}
                      onNewThread={section.onNewThread}
                      onFocus={section.onFocus}
                      hoverGroup="section"
                    />
                  </div>
                  <div className="space-y-0.5">{rows(shown)}</div>
                </div>
              )
            );
          })
        ) : (
          <div className="space-y-0.5">{rows(visible)}</div>
        ))}
    </section>
  );
}

/** A thin rule under "Ждут тебя". */
function Divider() {
  return <div role="separator" className="mx-2 h-px shrink-0 bg-sidebar-border" />;
}

function RecentList({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const { status, threads, projects } = experimental_useSidebarThreads();
  const { providers } = experimental_useProviders();
  const [hours, setHours] = useWindowHours();
  const [collapsed, toggleCollapsed] = useStoredSet(COLLAPSED_KEY);
  const [expanded, toggleExpanded] = useStoredSet(EXPANDED_KEY);
  // "Висят" always starts folded; unfolding it is not remembered.
  const [staleOpen, setStaleOpen] = useState(false);
  const [waitingByProject, setWaitingByProject] = useState(() => localStorage.getItem(WAITING_SORT_KEY) === "1");
  const chooseWaitingByProject = (next: boolean) => {
    localStorage.setItem(WAITING_SORT_KEY, next ? "1" : "0");
    setWaitingByProject(next);
  };
  const draftSeen = useDraftSeen();
  const now = useNow();
  const { lastPrompt, error } = useLastPrompts(sdk, usePromptSignal(threads));
  const dismissedWaiting = useTimes(DISMISSED_KEY);
  const awaitingReply = useAwaitingReply(threads, status, lastPrompt, dismissedWaiting);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  // An open subagent stays in "waiting" after it is read, until another opens.
  const [keepWaitingId, setKeepWaitingId] = useState<string | null>(null);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  useEffect(() => {
    const open = threadsRef.current.find((thread) => thread.id === activeThreadId);
    setKeepWaitingId(open && isWaiting(open) ? open.id : null);
  }, [activeThreadId]);

  const view = useMemo(
    () =>
      lastPrompt
        ? recentView({ threads, lastPrompt, draftSeen, hours, now, projectNames, awaitingReply, keepWaitingId, dismissedWaiting })
        : null,
    [threads, lastPrompt, draftSeen, hours, now, projectNames, awaitingReply, keepWaitingId, dismissedWaiting],
  );
  // Project places in the split "Ждут тебя", kept so archiving a thread does not reshuffle them.
  const waitingRanks = useRef<ReadonlyMap<string, number>>(new Map());
  const waitingSections = useMemo(() => {
    if (!view) return [];
    waitingRanks.current = projectRanks(view.waiting, waitingRanks.current);
    return byProject(view.waiting, waitingRanks.current);
  }, [view]);
  const [focusedId, setFocusedId] = useState(() => localStorage.getItem(FOCUS_KEY));
  const focusOn = useCallback((id: string | null) => {
    if (id) localStorage.setItem(FOCUS_KEY, id);
    else localStorage.removeItem(FOCUS_KEY);
    setFocusedId(id);
  }, []);
  const toggleFocus = (id: string) => {
    if (focusedId === id) return focusOn(null);
    focusOn(id);
    if (id !== activeThreadId) {
      onNavigate();
      navigate.toThread(id);
    }
  };
  const focused = useMemo(
    () => (focusedId && status === "ready" ? focusTree(threads, focusedId, lastPrompt ?? new Map()) : null),
    [focusedId, status, threads, lastPrompt],
  );
  // Archiving or deleting the focused thread ends focus.
  useEffect(() => {
    if (focusedId && status === "ready" && !focused) focusOn(null);
  }, [focusedId, status, focused, focusOn]);
  const [pomodoro, setPomodoro] = useProjectFocus();
  // The view of the project in focus opens with its stale threads unfolded.
  const [focusStaleOpen, setFocusStaleOpen] = useState(true);
  const tick = useSecondTick(pomodoro !== null);
  const remaining = pomodoro ? pomodoro.endsAt - tick : 0;
  const pomodoroDone = pomodoro !== null && remaining <= 0;
  const announcedEnd = useRef<number | null>(null);
  useEffect(() => {
    if (!pomodoro || !pomodoroDone || announcedEnd.current === pomodoro.endsAt) return;
    announcedEnd.current = pomodoro.endsAt;
    // A pomodoro that ended while bb was closed is not announced.
    if (Date.now() - pomodoro.endsAt < 60_000)
      toast.success("Помодоро закончился", { description: "Можно выйти из фокуса или взять ещё 30 минут." });
  }, [pomodoro, pomodoroDone]);
  const startPomodoro = (projectId: string) => {
    const previous = pomodoro;
    const next = { projectId, endsAt: Date.now() + POMODORO_MS };
    setPomodoro(next);
    setFocusStaleOpen(true);
    // A misclick can be taken back while the toast is up; after that, exit waits for the timer.
    toast.success(`Фокус на ${projectNames.get(projectId) ?? projectId}: 30 минут`, {
      action: {
        label: "Отменить",
        onClick: () => {
          if (parseProjectFocus(localStorage.getItem(PROJECT_FOCUS_KEY))?.endsAt === next.endsAt) setPomodoro(previous);
        },
      },
    });
  };
  const newThreadIn = (projectId: string) => () => {
    onNavigate();
    navigate.toCompose({ projectId, focusPrompt: true });
  };
  const context: RowContext = {
    activeThreadId, now, providers, expanded, toggleExpanded, focusedId, toggleFocus, onNavigate,
  };
  const promptLabel = (node: RecentNode<PluginSidebarThread>) =>
    node.promptAt !== null ? ago(node.promptAt, now) : node.draftOnly ? "черновик" : "";
  const attentionLabel = (node: RecentNode<PluginSidebarThread>) => ago(node.thread.latestAttentionAt, now);
  const activityLabel = (node: RecentNode<PluginSidebarThread>) => ago(node.thread.updatedAt, now);
  // A project in focus also lists sessions outside the window, by their last activity.
  const sessionLabel = (node: RecentNode<PluginSidebarThread>) =>
    node.promptAt === null && !node.draftOnly ? activityLabel(node) : promptLabel(node);
  const loading = view === null || status === "loading";

  if (focused)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-1 bg-sidebar px-2 pb-2 pt-1">
          <span className="flex h-6 min-w-0 items-center gap-1 px-1.5 text-xs font-medium text-sidebar-foreground">
            <FocusIcon className="size-3.5 shrink-0" />
            <span className="truncate">Фокус</span>
          </span>
          <button
            type="button"
            onClick={() => focusOn(null)}
            className="ml-auto flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2"
          >
            Все треды
          </button>
        </div>
        <div className="space-y-0.5 px-2 pb-2">
          <ThreadTree node={focused} depth={0} label={activityLabel} context={context} />
        </div>
      </div>
    );

  if (pomodoro) {
    const name = projectNames.get(pomodoro.projectId) ?? pomodoro.projectId;
    const project = view ? projectView(view, pomodoro.projectId) : null;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-1 bg-sidebar px-2 pb-2 pt-1">
          <span className="flex h-6 min-w-0 items-center gap-1 px-1.5 text-xs font-medium text-sidebar-foreground">
            <FocusIcon className="size-3.5 shrink-0" />
            <span className="truncate">{name}</span>
          </span>
          <span
            role="timer"
            aria-label={pomodoroDone ? "Помодоро закончился" : `До конца помодоро ${countdown(remaining)}`}
            className={cn(
              "shrink-0 px-1 text-xs tabular-nums",
              pomodoroDone ? "text-sidebar-accent-foreground" : "text-muted-foreground",
            )}
          >
            {pomodoroDone ? "готово" : countdown(remaining)}
          </span>
          <button
            type="button"
            aria-label={`Новый тред в ${name}`}
            title={`Новый тред в ${name}`}
            onClick={newThreadIn(pomodoro.projectId)}
            className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
          >
            <Icon name="MessageSquarePlus" className="size-4" aria-hidden />
          </button>
          {pomodoroDone && (
            <button
              type="button"
              onClick={() => startPomodoro(pomodoro.projectId)}
              className="flex h-6 shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-xs text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2"
            >
              +30 мин
            </button>
          )}
          <button
            type="button"
            disabled={!pomodoroDone}
            onClick={() => setPomodoro(null)}
            title={pomodoroDone ? "Вернуться ко всем проектам" : "Выйти можно, когда закончится помодоро"}
            className="flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs text-muted-foreground ring-sidebar-ring enabled:hover:bg-sidebar-accent enabled:hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
          >
            {!pomodoroDone && <Icon name="Lock" className="size-3 shrink-0" aria-hidden />}
            Выйти
          </button>
        </div>
        {error ? (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            История промптов не загрузилась: {error}
          </p>
        ) : loading || !project ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Загружаю…</p>
        ) : (
          <div className="flex flex-col gap-3 px-2 pb-2">
            {project.waiting.length + project.threads.length + project.stale.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">В проекте нет активных тредов.</p>
            )}
            {project.waiting.length > 0 && (
              <Group
                name="Ждут тебя"
                isCollapsed={collapsed.has(WAITING_GROUP)}
                onToggle={() => toggleCollapsed(WAITING_GROUP)}
                nodes={project.waiting}
                label={attentionLabel}
                context={context}
              />
            )}
            {project.waiting.length > 0 && project.threads.length + project.stale.length > 0 && <Divider />}
            {project.threads.length > 0 && (
              <Group
                name="Сессии"
                count={project.threads.length}
                isCollapsed={collapsed.has(pomodoro.projectId)}
                onToggle={() => toggleCollapsed(pomodoro.projectId)}
                nodes={project.threads}
                label={sessionLabel}
                context={context}
              />
            )}
            {project.stale.length > 0 && (
              <Group
                name="Висят"
                count={project.stale.length}
                isCollapsed={!focusStaleOpen}
                onToggle={() => setFocusStaleOpen((open) => !open)}
                nodes={project.stale}
                label={activityLabel}
                context={context}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-1 bg-sidebar px-2 pb-2 pt-1">
        <div role="radiogroup" aria-label="Окно" className="flex items-center gap-0.5">
          {WINDOWS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === hours}
              onClick={() => setHours(option)}
              className={cn(
                "h-6 shrink-0 whitespace-nowrap rounded-md px-1.5 text-xs tabular-nums ring-sidebar-ring focus-visible:outline-none focus-visible:ring-2",
                option === hours
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              {option} ч
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void toggleList(sdk)}
          title="Все треды (⌘⇧R)"
          className="ml-auto flex h-6 min-w-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2"
        >
          <Icon name="ListView" className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Все</span>
        </button>
      </div>

      {error ? (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          История промптов не загрузилась: {error}
        </p>
      ) : loading ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">Загружаю…</p>
      ) : (
        <div className="flex flex-col gap-3 px-2 pb-2">
          {view.waiting.length === 0 && view.groups.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              За последние {hours} ч твоих сообщений нет.
            </p>
          )}
          {view.waiting.length > 0 && (
            <Group
              name="Ждут тебя"
              isCollapsed={collapsed.has(WAITING_GROUP)}
              onToggle={() => toggleCollapsed(WAITING_GROUP)}
              actions={
                <div role="radiogroup" aria-label="Порядок «Ждут тебя»" className="flex shrink-0 items-center">
                  {(
                    [
                      [false, "TimeSchedule", "По времени"],
                      [true, "Folder", "По проектам"],
                    ] as const
                  ).map(([value, icon, title]) => (
                    <button
                      key={title}
                      type="button"
                      role="radio"
                      aria-checked={waitingByProject === value}
                      aria-label={title}
                      title={title}
                      onClick={() => chooseWaitingByProject(value)}
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 outline-none ring-sidebar-ring focus-visible:opacity-100 focus-visible:ring-2 group-hover/group:opacity-100 max-md:pointer-coarse:opacity-100",
                        waitingByProject === value
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-subtle-foreground hover:bg-state-hover hover:text-muted-foreground",
                      )}
                    >
                      <Icon name={icon} className="size-3.5" aria-hidden />
                    </button>
                  ))}
                </div>
              }
              nodes={view.waiting}
              sections={
                waitingByProject
                  ? waitingSections.map(({ projectId, threads }) => ({
                      key: projectId,
                      name: projectNames.get(projectId) ?? projectId,
                      nodes: threads,
                      onNewThread: newThreadIn(projectId),
                      onFocus: () => startPomodoro(projectId),
                    }))
                  : undefined
              }
              label={attentionLabel}
              context={context}
            />
          )}
          {view.waiting.length > 0 && (view.groups.length > 0 || view.stale.length > 0) && <Divider />}
          {view.groups.map((group) => (
            <Group
              key={group.projectId}
              name={projectNames.get(group.projectId) ?? group.projectId}
              isCollapsed={collapsed.has(group.projectId)}
              onToggle={() => toggleCollapsed(group.projectId)}
              onNewThread={newThreadIn(group.projectId)}
              onFocus={() => startPomodoro(group.projectId)}
              nodes={group.threads}
              label={promptLabel}
              context={context}
            />
          ))}
          {view.stale.length > 0 && (
            <Group
              name="Висят"
              count={view.stale.length}
              isCollapsed={!staleOpen}
              onToggle={() => setStaleOpen((open) => !open)}
              nodes={view.stale}
              label={activityLabel}
              context={context}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadAction({
    id: "dismissWaiting",
    title: "Dismiss waiting status",
    icon: "Check",
    group: "organize",
    useData: () => ({
      threads: experimental_useSidebarThreads().threads,
      awaiting: useTimes(AWAITING_KEY),
      dismissed: useTimes(DISMISSED_KEY),
    }),
    item: ({ thread, data }) => {
      const listed = data.threads.find(({ id }) => id === thread.id);
      if (!listed || listed.isArchived || listed.isHidden ||
          isWaitingDismissed(listed, data.dismissed) ||
          (!isWaiting(listed) && data.awaiting[thread.id] === undefined)) return null;
      return {
        label: "Dismiss waiting status",
        icon: "Check",
        run: () => {
          const at = listed.latestAttentionAt;
          const awaitingAt = readTimes(AWAITING_KEY)[thread.id];
          writeTimes(DISMISSED_KEY, { ...readTimes(DISMISSED_KEY), [thread.id]: at });
          toast.success("Waiting status dismissed", {
            action: {
              label: "Undo",
              onClick: () => {
                const dismissed = readTimes(DISMISSED_KEY);
                if (dismissed[thread.id] !== at) return;
                delete dismissed[thread.id];
                if (awaitingAt !== undefined)
                  writeTimes(AWAITING_KEY, { ...readTimes(AWAITING_KEY), [thread.id]: awaitingAt });
                writeTimes(DISMISSED_KEY, dismissed);
              },
            },
          });
        },
      };
    },
  });
  app.slots.experimental_appOverlay({ id: "sdk", component: SdkBridge });
  app.slots.experimental_threadList({
    id: LIST_ID,
    title: "Недавние",
    description: "Только треды с твоими сообщениями за последние часы, по проектам.",
    component: RecentList,
  });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "toggle",
    label: "Недавние / все треды",
    icon: "Clock",
    onActivate: () => toggleList(),
  });
  app.commands.register({
    id: "toggle",
    title: "Список тредов: недавние / все",
    defaultShortcut: { key: "r", mod: true, shift: true },
    run: () => toggleList(),
  });
});
