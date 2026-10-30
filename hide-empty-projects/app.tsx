// Hides empty projects in the sidebar's More menu as well: the server says
// which projects have no active threads, and a stylesheet drops their items.
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

const EMPTY_CHANGED = "empty-changed";

function HideEmptyInMore() {
  const rpc = useRpc<typeof rpcContract>();
  const [ids, setIds] = useState<string[]>([]);
  const refetch = useCallback(() => {
    rpc.call("empty_projects").then(({ projectIds }) => setIds(projectIds), () => {});
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime(EMPTY_CHANGED, refetch);
  if (ids.length === 0) return null;
  const css = ids.map((id) => `[data-sidebar-overflow-item="project:${id}"]`).join(",\n") + " { display: none !important; }";
  return <style>{css}</style>;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "hide-empty-in-more", component: HideEmptyInMore });
});
