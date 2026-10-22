// bb-plugin-copy-file — a "Copy file" button next to Refresh / Copy contents /
// Open in editor in the header of bb's file viewer.
//
// bb has no slot for file-header actions, so an app overlay watches the DOM for
// the header's path button and adds a button beside it. The file's path and
// thread context come from the React props of that header. Clicking asks the
// server to put the file itself on the macOS clipboard.
//
// A browser can't put a file on the clipboard (only text, HTML and PNG), so
// there the button copies images as PNG, opens the share sheet for other files
// (iOS offers "Copy" there), and downloads the file when sharing is missing.
import { useEffect } from "react";
import { definePluginApp, useRpc, type PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";

declare global {
  interface Window {
    bbDesktop?: unknown;
  }
}

const BUTTON_ATTR = "data-bb-copy-file";
const PATH_BUTTON = 'button[aria-label="Copy file path"]';
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M16 4h2a2 2 0 0 1 2 2v4"/><path d="M21 14H11"/><path d="m15 10-4 4 4 4"/></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

type FileContext = {
  path: string;
  copyPath: string | null;
  environmentId: string | null;
  threadId: string | null;
};

type Fiber = { memoizedProps?: Record<string, unknown> | null; return: Fiber | null };

function stringProp(props: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in props)) return undefined;
  const value = props[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read path and thread context from the React props above the header's path button. */
function fileContext(pathButton: Element): FileContext | null {
  const key = Object.keys(pathButton).find((name) => name.startsWith("__reactFiber$"));
  let fiber = key ? ((pathButton as unknown as Record<string, Fiber>)[key] ?? null) : null;
  const found: Partial<Record<keyof FileContext, string | null>> = {};
  for (let depth = 0; fiber && depth < 120; depth++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (!props || typeof props !== "object") continue;
    for (const name of ["path", "copyPath", "environmentId", "threadId"] as const) {
      if (found[name] !== undefined) continue;
      const value = stringProp(props, name);
      // The header's path component carries `path` and `copyPath` together.
      if (name === "path" && !("copyPath" in props)) continue;
      if (value !== undefined) found[name] = value;
    }
  }
  if (!found.path) return null;
  return {
    path: found.path,
    copyPath: found.copyPath ?? null,
    environmentId: found.environmentId ?? null,
    threadId: found.threadId ?? location.pathname.match(/thr_[A-Za-z0-9]+/)?.[0] ?? null,
  };
}

type Rpc = PluginRpcClient<typeof rpcContract>;

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

/** Download the file through the server in chunks. */
async function fetchFile(rpc: Rpc, context: FileContext): Promise<File> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; ; ) {
    const { name, mimeType, size, base64 } = await rpc.call("read_file", { ...context, offset });
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    chunks.push(bytes);
    offset += bytes.length;
    if (offset >= size || bytes.length === 0) return new File(chunks, name, { type: mimeType });
  }
}

/** PNG bytes of an image file: the clipboard accepts only image/png. */
async function asPng(file: File): Promise<Blob> {
  if (file.type === "image/png") return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("PNG encode failed"))), "image/png"),
  );
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Hand a fetched file to the share sheet, or download it. Returns the button label. */
async function shareOrDownload(
  file: File,
  pending: Map<string, File>,
  key: string,
  retry = false,
): Promise<string | null> {
  if (!navigator.canShare?.({ files: [file] })) {
    download(file);
    return `Downloaded ${file.name}`;
  }
  try {
    await navigator.share({ files: [file] });
    return `Shared ${file.name}`;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    if (!(error instanceof DOMException && error.name === "NotAllowedError")) throw error;
    // Safari drops the click's user activation while the file downloads; the
    // next click shares the already fetched file right away. If even that is
    // refused, sharing is blocked here: download instead.
    if (retry) {
      download(file);
      return `Downloaded ${file.name}`;
    }
    pending.set(key, file);
    return "Click again to share";
  }
}

function CopyFileButtons() {
  const rpc = useRpc<typeof rpcContract>();

  useEffect(() => {
    const pendingShares = new Map<string, File>();
    const timers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
    const flash = (button: HTMLButtonElement, label: string, icon: string) => {
      button.innerHTML = icon;
      button.title = label;
      clearTimeout(timers.get(button));
      timers.set(
        button,
        setTimeout(() => {
          timers.delete(button);
          button.innerHTML = COPY_ICON;
          button.title = "Copy file";
        }, 1600),
      );
    };

    const makeButton = (pathButton: Element) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(BUTTON_ATTR, "");
      button.setAttribute("aria-label", "Copy file");
      button.title = "Copy file";
      button.innerHTML = COPY_ICON;
      button.addEventListener("click", () => {
        const context = fileContext(pathButton);
        if (!context) {
          flash(button, "Copy file: path unknown", COPY_ICON);
          return;
        }
        const fail = (error: unknown) => {
          console.error("[copy-file]", error);
          flash(button, `Copy file failed: ${error instanceof Error ? error.message : String(error)}`, COPY_ICON);
        };
        if (window.bbDesktop !== undefined) {
          rpc.call("copy_file", context).then((result) => flash(button, `Copied ${result.path}`, CHECK_ICON), fail);
          return;
        }
        const key = context.copyPath ?? context.path;
        const pending = pendingShares.get(key);
        pendingShares.delete(key);
        if (pending) {
          shareOrDownload(pending, pendingShares, key, true).then(
            (label) => label && flash(button, label, CHECK_ICON),
            fail,
          );
        } else if (IMAGE_EXTENSIONS.test(context.path) && typeof ClipboardItem !== "undefined") {
          // A promise-valued ClipboardItem keeps the click's user activation.
          const png = fetchFile(rpc, context).then(asPng);
          navigator.clipboard
            .write([new ClipboardItem({ "image/png": png })])
            .then(() => flash(button, "Copied image", CHECK_ICON), fail);
        } else {
          fetchFile(rpc, context)
            .then((file) => shareOrDownload(file, pendingShares, key))
            .then((label) => label && flash(button, label, label.startsWith("Click") ? COPY_ICON : CHECK_ICON), fail);
        }
      });
      return button;
    };

    const FALLBACK_CLASS =
      "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground";

    const decorate = () => {
      for (const pathButton of document.querySelectorAll(PATH_BUTTON)) {
        const row = pathButton.parentElement;
        // Skip the loading skeleton's path-only header.
        if (!row || row.closest('[role="status"]')) continue;
        const button = row.querySelector<HTMLButtonElement>(`[${BUTTON_ATTR}]`) ?? makeButton(pathButton);
        // bb's header buttons come and go with the panel width; stay after them
        // and look like them.
        const sibling = row.querySelector('button[aria-label="Refresh file"], button[aria-label^="Open in editor"]');
        const className = sibling?.className ?? FALLBACK_CLASS;
        if (button.className !== className) button.className = className;
        if (row.lastElementChild !== button) row.append(button);
      }
    };

    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const timer of timers.values()) clearTimeout(timer);
      for (const button of document.querySelectorAll(`[${BUTTON_ATTR}]`)) button.remove();
    };
  }, [rpc]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "copy-file-buttons", component: CopyFileButtons });
});
