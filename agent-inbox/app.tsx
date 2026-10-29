import { useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  experimental_Icon as Icon,
  ThreadChat,
  useBbNavigate,
  useSdk,
  type PluginSidebarThread,
  type PluginHomepageSectionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { cn } from "./lib/utils";
import {
  applyReview,
  busy,
  needsReview,
  parseLedger,
  reason,
  reconcile,
  type Ledger,
} from "./inbox";

const KEY = "agent-inbox:ledger:v1";
const EVENT = "agent-inbox:changed";
const labels = {
  input: "Нужен ответ",
  error: "Нужна проверка",
  reply: "Ответ готов",
};
function useInbox() {
  const state = experimental_useSidebarThreads();
  const [ledger, setLedger] = useState<Ledger>(() =>
    parseLedger(localStorage.getItem(KEY)),
  );
  const [now, setNow] = useState(Date.now);
  const save = (value: Ledger) => {
    localStorage.setItem(KEY, JSON.stringify(value));
    window.dispatchEvent(new Event(EVENT));
  };
  useEffect(() => {
    const sync = () => setLedger(parseLedger(localStorage.getItem(KEY)));
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      clearInterval(timer);
    };
  }, []);
  const merged = useMemo(
    () =>
      state.status === "ready" ? reconcile(ledger, state.threads) : ledger,
    [ledger, state.threads, state.status],
  );
  useEffect(() => {
    if (JSON.stringify(merged) !== JSON.stringify(ledger)) save(merged);
  }, [merged, ledger]);
  const visible = state.threads.filter((t) => !t.isArchived && !t.isHidden);
  const waiting = visible
    .filter((t) => needsReview(t, merged, now))
    .sort((a, b) => {
      const rank = { input: 0, error: 1, reply: 2 };
      return (
        rank[reason(a)] - rank[reason(b)] ||
        b.latestAttentionAt - a.latestAttentionAt ||
        a.id.localeCompare(b.id)
      );
    });
  const update = (t: PluginSidebarThread, snooze = false) => {
    const current = reconcile(
      parseLedger(localStorage.getItem(KEY)),
      state.threads,
    );
    save(applyReview(current, t, snooze ? Date.now() + 3_600_000 : undefined));
  };
  return { ...state, visible, waiting, update, running: visible.filter(busy) };
}
function Stamp({ thread }: { thread: PluginSidebarThread }) {
  const kind = reason(thread);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs",
        kind === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon
        name={
          kind === "input"
            ? "MessageCircle"
            : kind === "error"
              ? "AlertCircle"
              : "Check"
        }
        className="size-3.5"
        aria-hidden
      />
      {labels[kind]}
    </span>
  );
}
function Widget({ projectId }: PluginHomepageSectionProps) {
  const inbox = useInbox();
  const navigate = useBbNavigate();
  const items = inbox.waiting.filter(
    (t) => !projectId || t.projectId === projectId,
  );
  const running = inbox.running.filter(
    (t) => !projectId || t.projectId === projectId,
  );
  if (inbox.status === "loading")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Загружаю входящие…
      </p>
    );
  if (inbox.status === "error")
    return (
      <p role="alert" className="text-sm text-destructive">
        Не удалось загрузить треды. Перезагрузите страницу.
      </p>
    );
  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {items.length ? `${items.length} ждут разбора` : "Всё разобрано"}
          {running.length ? ` · ${running.length} в работе` : ""}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate.toPluginPanel("inbox")}
        >
          Все входящие
          <Icon name="ArrowRight" className="size-4" />
        </Button>
      </div>
      <div className="divide-y divide-border">
        {items.slice(0, 3).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate.toPluginPanel("inbox", { subPath: t.id })}
            className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate">{t.displayTitle}</span>
            <Stamp thread={t} />
          </button>
        ))}
      </div>
    </div>
  );
}
function InboxPage({ subPath }: { subPath: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= 800),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const inbox = useInbox();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const [filter, setFilter] = useState("waiting");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelected] = useState<string | null>(subPath || null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSelected(subPath || null), [subPath]);
  const source = filter === "running" ? inbox.running : inbox.waiting;
  const items = source.filter(
    (t) =>
      (!project || t.projectId === project) &&
      t.displayTitle.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const selected = inbox.visible.find((t) => t.id === selectedId);
  const projectName = (id: string) =>
    inbox.projects.find((p) => p.id === id)?.name ?? "Проект";
  const open = (t: PluginSidebarThread) => {
    setSelected(t.id);
    navigate.toPluginPanel("inbox", { subPath: t.id });
  };
  const review = async () => {
    if (
      !selected ||
      pending ||
      selected.hasPendingInteraction ||
      selected.queuedWork === "failed" ||
      busy(selected)
    )
      return;
    const target = selected;
    setPending(true);
    setError(null);
    try {
      await sdk.threads.markRead({ threadId: target.id });
      inbox.update(target);
      const next = items.find((t) => t.id !== target.id);
      setSelected(next?.id ?? null);
      navigate.toPluginPanel("inbox", {
        subPath: next?.id ?? "",
        replace: true,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      ref={frame}
      className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-base font-semibold">Входящие от агентов</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Разберите ответы, пока остальные агенты работают.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate.toCompose({ focusPrompt: true })}
        >
          <Icon name="Plus" className="size-4" />
          Новый тред
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Очередь агентов"
          className={cn(
            "flex w-full shrink-0 flex-col",
            wide && "w-80 border-r border-border",
            selected && !wide && "hidden",
          )}
        >
          <div className="space-y-3 border-b border-border p-3">
            <div
              className="flex gap-1"
              role="group"
              aria-label="Показать треды"
            >
              {[
                ["waiting", "Ждут разбора", inbox.waiting.length],
                ["running", "В работе", inbox.running.length],
              ].map(([id, label, count]) => (
                <Button
                  key={id}
                  size="sm"
                  variant={filter === id ? "secondary" : "ghost"}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(String(id))}
                >
                  {label}
                  <span className="tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </Button>
              ))}
            </div>
            <Input
              aria-label="Поиск по тредам"
              placeholder="Найти тред…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Проект"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Все проекты</option>
              {inbox.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {inbox.status !== "ready" ? (
              <p
                role={inbox.status === "error" ? "alert" : "status"}
                className="p-3 text-sm text-muted-foreground"
              >
                {inbox.status === "error"
                  ? "Не удалось загрузить треды. Перезагрузите страницу."
                  : "Загружаю входящие…"}
              </p>
            ) : items.length === 0 ? (
              <div role="status" className="px-3 py-10 text-center">
                <Icon
                  name={filter === "running" ? "Coffee" : "Inbox"}
                  className="mx-auto mb-3 size-6 text-muted-foreground"
                />
                <p className="text-sm font-medium">
                  {query || project
                    ? "Ничего не найдено"
                    : filter === "running"
                      ? "Агенты отдыхают"
                      : "Всё разобрано"}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {query || project
                    ? "Измените поиск или выберите другой проект."
                    : "Новые ответы появятся здесь автоматически."}
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {items.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-current={selected?.id === t.id ? "true" : undefined}
                      onClick={() => open(t)}
                      className={cn(
                        "w-full rounded-md p-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        selected?.id === t.id && "bg-accent",
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {projectName(t.projectId)}
                        </span>
                        {filter === "waiting" ? (
                          <Stamp thread={t} />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            В работе
                          </span>
                        )}
                      </div>
                      <div className="break-words text-sm font-medium leading-snug">
                        {t.displayTitle}
                      </div>
                      {t.environment?.branchName && (
                        <div className="mt-2 truncate text-xs text-muted-foreground">
                          {t.environment.branchName}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Разобрано и «Позже» сохраняются в этом браузере.
          </p>
        </section>
        <section
          aria-label="Выбранный тред"
          className={cn(
            "min-w-0 flex-1 flex-col",
            selected || wide ? "flex" : "hidden",
          )}
        >
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className={wide ? "hidden" : undefined}
                  onClick={() => {
                    setSelected(null);
                    navigate.toPluginPanel("inbox");
                  }}
                >
                  <Icon name="ArrowLeft" className="size-4" />
                  Назад
                </Button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium",
                    !wide && "order-first basis-full",
                  )}
                >
                  {selected.displayTitle}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Открыть тред целиком"
                  onClick={() => navigate.toThread(selected.id)}
                >
                  <Icon name="ExternalLink" className="size-4" />
                </Button>
                {filter === "waiting" && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        inbox.update(selected, true);
                        setSelected(null);
                        navigate.toPluginPanel("inbox");
                      }}
                    >
                      Позже · 1 ч
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        pending ||
                        busy(selected) ||
                        selected.hasPendingInteraction ||
                        selected.queuedWork === "failed"
                      }
                      onClick={() => void review()}
                    >
                      <Icon name="Check" className="size-4" />
                      {pending ? "Сохраняю…" : "Разобрано"}
                    </Button>
                  </>
                )}
              </div>
              {error && (
                <p role="alert" className="px-4 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="min-h-0 flex-1">
                <ThreadChat
                  key={selected.id}
                  threadId={selected.id}
                  variant="compact"
                  layout="contained"
                  permissionPolicy="inherit"
                  className="h-full"
                />
              </div>
            </>
          ) : (
            <div className="m-auto max-w-sm px-6 py-12 text-center">
              <Icon
                name="Inbox"
                className="mx-auto mb-4 size-8 text-muted-foreground"
              />
              <h2 className="text-base font-medium">Один тред за раз</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Выберите ответ слева. Здесь откроется привычный чат bb — можно
                проверить результат и продолжить работу.
              </p>
              {items[0] && (
                <Button
                  className="mt-5"
                  variant="outline"
                  onClick={() => open(items[0])}
                >
                  Разобрать первый
                  <Icon name="ArrowRight" className="size-4" />
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "inbox",
    path: "inbox",
    title: "Agent Inbox",
    icon: "Inbox",
    component: InboxPage,
  });
  app.slots.homepageSection({
    id: "inbox",
    title: "Входящие от агентов",
    component: Widget,
  });
});
