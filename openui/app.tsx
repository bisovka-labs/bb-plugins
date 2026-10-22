// bb-plugin-openui — frontend.
//
// Registers the ::openui{file="…"} message directive. The spec is read over
// RPC, rendered by the vendored OpenUI renderer inside an opaque-origin
// iframe (server.ts GET /renderer), and button actions come back here:
// @ToAssistant sends a message to this thread, @OpenUrl opens a new tab.
import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  useComposer,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 1600;

type Load =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "error"; message: string };

type OpenUiAction = {
  type?: unknown;
  params?: Record<string, unknown>;
  humanFriendlyMessage?: unknown;
  formState?: unknown;
};

function useDarkTheme(): boolean {
  const read = () => document.documentElement.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** OpenUI form state is { form: { field: { value, … } } }; the agent only needs { field: value }. */
function formValues(formState: unknown): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (typeof formState !== "object" || formState === null) return values;
  for (const fields of Object.values(formState)) {
    if (typeof fields !== "object" || fields === null) continue;
    for (const [name, field] of Object.entries(fields)) {
      values[name] = typeof field === "object" && field !== null && "value" in field ? field.value : field;
    }
  }
  return values;
}

/** The user-visible message for a @ToAssistant click, with hidden data appended as JSON. */
function actionMessage(action: OpenUiAction): string | null {
  const params = action.params ?? {};
  const label =
    (typeof params.message === "string" && params.message.trim()) ||
    (typeof action.humanFriendlyMessage === "string" && action.humanFriendlyMessage.trim()) ||
    "";
  if (!label) return null;
  const data: Record<string, unknown> = {};
  if (!isEmptyValue(params.context)) data.context = params.context;
  const form = formValues(action.formState);
  if (!isEmptyValue(form)) data.form = form;
  if (Object.keys(data).length === 0) return label;
  return `${label}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

function OpenUiDirective({ attributes, source, message }: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const pluginId = experimental_usePluginId();
  const dark = useDarkTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [frameReady, setFrameReady] = useState(false);
  const [height, setHeight] = useState(160);
  const [errors, setErrors] = useState<string[]>([]);

  const file = attributes.file?.trim() ?? "";
  const specSource = attributes.source === "thread-storage" ? "thread-storage" : "workspace";

  useEffect(() => {
    if (!file) {
      setLoad({ status: "error", message: 'openui needs a file attribute, e.g. ::openui{file="ui/demo.oui"}' });
      return;
    }
    let cancelled = false;
    setLoad({ status: "loading" });
    rpc
      .call("loadSpec", { threadId: message.threadId, file, source: specSource })
      .then((result) => {
        if (cancelled) return;
        setLoad(
          result.kind === "ok"
            ? { status: "ready", content: result.content }
            : { status: "error", message: `File not found: ${result.file}` },
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, message.threadId, file, specSource]);

  useEffect(() => {
    if (!frameReady || load.status !== "ready") return;
    frame.current?.contentWindow?.postMessage(
      { type: "openui:render", response: load.content, theme: dark ? "dark" : "light" },
      "*",
    );
  }, [frameReady, load, dark]);

  useEffect(() => {
    async function sendToThread(action: OpenUiAction) {
      const text = actionMessage(action);
      if (!text) return;
      if (composer.scope.kind !== "thread" || composer.scope.threadId !== message.threadId) {
        toast("OpenUI: open this thread to send the action");
        return;
      }
      if (!composer.isEmpty) {
        composer.insert(text, { at: "end", block: true });
        toast("OpenUI: added to your draft — send it when ready");
        return;
      }
      composer.insert(text, { at: "end" });
      try {
        await composer.submit({ experimental_data: { action: "continue_conversation" } });
      } catch (error) {
        toast(`OpenUI: left in the composer — ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    function openUrl(raw: unknown) {
      if (typeof raw !== "string") return;
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return;
      }
      if (url.protocol === "https:" || url.protocol === "http:") {
        window.open(url.href, "_blank", "noopener,noreferrer");
      }
    }

    function onMessage(event: MessageEvent) {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: unknown } & Record<string, unknown>;
      switch (data?.type) {
        case "openui:ready":
          setFrameReady(true);
          break;
        case "openui:height":
          if (typeof data.height === "number" && Number.isFinite(data.height)) {
            setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height))));
          }
          break;
        case "openui:errors":
          setErrors(
            Array.isArray(data.errors)
              ? data.errors
                  .filter((e: { severity?: unknown }) => e?.severity !== "warning")
                  .map((e: { message?: unknown }) => String(e?.message ?? e))
                  .slice(0, 5)
              : [],
          );
          break;
        case "openui:action": {
          const action = (data.action ?? {}) as OpenUiAction;
          if (action.type === "continue_conversation") void sendToThread(action);
          else if (action.type === "open_url") openUrl(action.params?.url);
          break;
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [composer, message.threadId]);

  if (load.status === "error") {
    return (
      <div role="alert" title={source} className="my-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
        openui: {load.message}
      </div>
    );
  }

  return (
    <div className="my-2">
      <div className="overflow-hidden rounded-lg border border-border">
        <iframe
          ref={frame}
          title={`OpenUI: ${file}`}
          src={`/api/v1/plugins/${encodeURIComponent(pluginId)}/http/renderer`}
          sandbox="allow-scripts"
          style={{ height, visibility: load.status === "ready" ? "visible" : "hidden" }}
          className="block w-full border-0 bg-transparent"
        />
      </div>
      {errors.length > 0 ? (
        <div className="mt-1 text-xs text-muted-foreground" title={errors.join("\n")}>
          openui: {errors.length} render issue{errors.length === 1 ? "" : "s"} — {errors[0]}
        </div>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({ id: "openui", component: OpenUiDirective });
});
