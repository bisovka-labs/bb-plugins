// Hides empty projects in the sidebar's More menu as well: the server says
// which projects have no active threads, and a stylesheet drops their items.
// A row at the end of More shows them again until the menu closes.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

const EMPTY_CHANGED = "empty-changed";

const itemSelector = (id: string) => `[data-sidebar-overflow-item="project:${id}"]`;

/** Where More's hidden empty projects sit, while the menu is open. */
function useMoreList(ids: string[]) {
  const [found, setFound] = useState<{ list: HTMLElement; count: number; className: string } | null>(null);
  useEffect(() => {
    if (ids.length === 0) return setFound(null);
    const selector = ids.map(itemSelector).join(",");
    let frame = 0;
    const scan = () => {
      frame = 0;
      const items = document.querySelectorAll<HTMLElement>(selector);
      const last = items[items.length - 1];
      const list = last?.parentElement ?? null;
      setFound((prev) =>
        prev?.list === list && prev?.count === items.length
          ? prev
          : list
            ? { list, count: items.length, className: last.className }
            : null,
      );
    };
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(scan);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ids]);
  return found;
}

function HideEmptyInMore() {
  const rpc = useRpc<typeof rpcContract>();
  const [ids, setIds] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const refetch = useCallback(() => {
    rpc.call("empty_projects").then(({ projectIds }) => setIds(projectIds), () => {});
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime(EMPTY_CHANGED, refetch);
  const more = useMoreList(ids);
  useEffect(() => {
    if (!more) setShowAll(false);
  }, [more]);
  if (ids.length === 0) return null;
  const css = ids.map(itemSelector).join(",\n") + " { display: none !important; }";
  return (
    <>
      {showAll ? null : <style>{css}</style>}
      {more
        ? createPortal(
            <button
              type="button"
              className={more.className}
              data-hide-empty-projects-toggle=""
              onClick={() => setShowAll((v) => !v)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1 text-left text-muted-foreground">
                {showAll ? "Скрыть пустые проекты" : `Показать пустые проекты (${more.count})`}
              </span>
            </button>,
            more.list,
          )
        : null}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "hide-empty-in-more", component: HideEmptyInMore });
});
