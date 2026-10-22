import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_useSidebarThreads,
  experimental_useThreadActions,
  type PluginThreadActionEntry,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import "./app.css";
import { startRowSwipe, type SwipeAction } from "./swipe";
import { FollowupsAction, RecapAction } from "./composer-actions";

// Superhuman's Mobile Layout: on a phone it hides BB's sidebar button and
// leaves only the swipe from the left edge.
const PHONE = "(width < 48rem) and (pointer: coarse)";

function subscribe(onChange: () => void) {
  const phone = window.matchMedia(PHONE);
  phone.addEventListener("change", onChange);
  return () => phone.removeEventListener("change", onChange);
}

function usePhone() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches);
}

/** BB's own PanelLeft icon, the mirror of the right panel's button. */
function PanelLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="sidebar-icon"
      aria-hidden
    >
      <path d="M2 12C2 8.31087 2 6.4663 2.81382 5.15877C3.1149 4.67502 3.48891 4.25427 3.91891 3.91554C5.08116 3 6.72077 3 10 3H14C17.2792 3 18.9188 3 20.0811 3.91554C20.5111 4.25427 20.8851 4.67502 21.1862 5.15877C22 6.4663 22 8.31087 22 12C22 15.6891 22 17.5337 21.1862 18.8412C20.8851 19.325 20.5111 19.7457 20.0811 20.0845C18.9188 21 17.2792 21 14 21H10C6.72077 21 5.08116 21 3.91891 20.0845C3.48891 19.7457 3.1149 19.325 2.81382 18.8412C2 17.5337 2 15.6891 2 12Z" />
      <path d="M9.5 3L9.5 21" />
      <path d="M5 7H6M5 10H6" />
    </svg>
  );
}

/** Presses BB's own sidebar button, which Mobile Layout hides on a phone. */
function toggleSidebar() {
  document
    .querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-trigger-overlay"] button[data-sidebar="trigger"]',
    )
    ?.click();
}

function SidebarButton({ className }: { className: string }) {
  return (
    <button
      type="button"
      className={className}
      aria-label="Show sidebar"
      title="Show sidebar"
      onClick={toggleSidebar}
    >
      <PanelLeftIcon />
    </button>
  );
}

/** On a phone, the button in a thread's bar. */
function ThreadBarButton() {
  return usePhone() ? <SidebarButton className="sidebar-button" /> : null;
}

/**
 * On a phone's home page, the button at the card's left end, opposite the
 * right panel's. It lives in BB's page, as that button does, so it slides
 * with the page when the sidebar opens.
 */
function HomeButton() {
  const phone = usePhone();
  const [page, setPage] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!phone) return;
    // The home page's own <main>, inside BB's, holds the right panel's button.
    const find = () =>
      setPage(document.querySelector<HTMLElement>('main:has(> div > [aria-label*="right panel"])'));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [phone]);
  if (!phone || !page) return null;
  return createPortal(<SidebarButton className="sidebar-button sidebar-home-button" />, page);
}

/** The thread as thread menus see it, while the sidebar lists it. */
function useListedThread(threadId: string | null): PluginThreadActionTarget | null {
  const { threads } = experimental_useSidebarThreads();
  const thread = threads.find((candidate) => candidate.id === threadId);
  return useMemo(
    () =>
      thread
        ? {
            id: thread.id,
            projectId: thread.projectId,
            parentThreadId: thread.parentThreadId,
            archivedAt: thread.archivedAt,
            pinnedAt: thread.pinnedAt,
            sectionId: thread.sectionId,
            isUnread: thread.isUnread,
            status: thread.status,
            environment: null,
          }
        : null,
    [thread],
  );
}

type Actions = Partial<Record<SwipeAction, PluginThreadActionEntry>>;

/** Recent Threads' dismiss-waiting action and BB's Archive for one thread, with their Undo and confirmations. */
function ThreadActions({
  thread,
  onActions,
}: {
  thread: PluginThreadActionTarget;
  onActions(actions: Actions): void;
}) {
  const entries = experimental_useThreadActions(thread);
  const actions = useMemo<Actions>(
    () => ({
      dismissWaiting: entries.find(({ key }) => key === "recent-threads/dismissWaiting"),
      archive: entries.find(({ key }) => key === "bb--core/archive"),
    }),
    [entries],
  );
  useEffect(() => onActions(actions), [actions, onActions]);
  // The icons the track clones while a row is swiped.
  return (
    <span data-row-swipe-icons hidden>
      {(["dismissWaiting", "archive"] as const).map((action) => {
        const icon = actions[action]?.action.icon;
        return icon ? (
          <span key={action} data-action={action}>
            <Icon name={icon} aria-hidden />
          </span>
        ) : null;
      })}
    </span>
  );
}

/** One light tap: BB's phone app plays it natively, a browser vibrates if it can. */
function tap() {
  const native = (window as Window & {
    bb?: { native?: { capabilities?: readonly string[]; post?(message: unknown): void } };
  }).bb?.native;
  if (native?.capabilities?.includes("haptic") && native.post) {
    native.post({ type: "haptic", kind: "impact-light" });
    return;
  }
  navigator.vibrate?.(10);
}

/** On a phone, swipes across the sidebar's thread rows: right dismisses waiting, left archives. */
function RowSwipe() {
  const phone = usePhone();
  const [threadId, setThreadId] = useState<string | null>(null);
  const thread = useListedThread(threadId);
  const actions = useRef<Actions>({});
  const actionThreadId = useRef<string | null>(null);
  useEffect(() => {
    if (!phone) return;
    return startRowSwipe(document, {
      onStart: (id) => {
        if (actionThreadId.current !== id) actions.current = {};
        actionThreadId.current = id;
        setThreadId(id);
      },
      available: (action) => {
        const entry = actions.current[action];
        return !!entry && !entry.action.disabled;
      },
      icon: (action) =>
        document.querySelector(`[data-row-swipe-icons] [data-action="${action}"] > *`),
      run: async (action) => {
        const entry = actions.current[action];
        if (entry && !entry.action.disabled) await entry.action.run();
      },
      tap,
    });
  }, [phone]);
  if (!phone || !thread) return null;
  return (
    <ThreadActions
      key={thread.id}
      thread={thread}
      onActions={(next) => {
        actions.current = next;
      }}
    />
  );
}

function Overlay() {
  return (
    <>
      <HomeButton />
      <RowSwipe />
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "showSidebar",
    title: "Sidebar",
    component: ThreadBarButton,
  });
  app.slots.experimental_appOverlay({ id: "mobileSidebar", component: Overlay });
  app.composer.customize({
    id: "manualRuns",
    scopes: ["thread"],
    actions: [
      { id: "recap", component: RecapAction },
      { id: "followups", component: FollowupsAction },
    ],
  });
});
