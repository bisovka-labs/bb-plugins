// bb-plugin-openui — backend.
//
// Two things: `loadSpec` reads an OpenUI Lang file from the thread's workspace
// or thread storage (confined to that root), and GET /renderer serves one
// self-contained HTML page with the vendored OpenUI renderer. app.tsx loads
// that page into a sandboxed iframe and hands it the spec over postMessage.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const MAX_SPEC_BYTES = 512 * 1024;
const SPEC_EXTENSIONS = new Set([".oui", ".openui"]);

/** Source-relative, no traversal, OpenUI extension. Throws a user-facing message. */
export function requireRelativeSpecFile(raw: string): string {
  const file = raw.trim().replace(/\\/g, "/");
  if (file.length === 0) throw new Error('"file" must be a non-empty path');
  if (file.startsWith("/") || /^[a-zA-Z]:\//.test(file)) {
    throw new Error(`"file" must be source-relative, not absolute: ${raw}`);
  }
  if (file.split("/").includes("..")) {
    throw new Error(`"file" must not contain traversal segments: ${raw}`);
  }
  const normalized = path.posix.normalize(file);
  if (!SPEC_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    throw new Error(`"file" must end with .oui or .openui, got ${JSON.stringify(raw)}`);
  }
  return normalized;
}

export const rpcContract = defineRpcContract({
  loadSpec: {
    input: z
      .object({
        threadId: z.string().trim().min(1),
        file: z.string().transform(requireRelativeSpecFile),
        source: z.enum(["workspace", "thread-storage"]).default("workspace"),
      })
      .strict(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("not-found"), file: z.string() }).strict(),
      z.object({ kind: z.literal("ok"), file: z.string(), content: z.string() }).strict(),
    ]),
  },
});

function httpStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** vendor/ sits beside server.ts on path installs and one level up from dist/server.js. */
function vendorDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "vendor"), path.join(here, "..", "vendor")]) {
    if (existsSync(path.join(candidate, "openui-bundle.min.js"))) return candidate;
  }
  throw new Error(`OpenUI vendor files not found near ${here}; run npm run vendor`);
}

// Inline text must not close its own <script>/<style> element early.
const escapeScript = (code: string) => code.replace(/<\/script/gi, "<\\/script");
const escapeStyle = (css: string) => css.replace(/<\/style/gi, "<\\/style");

function rendererHtml(): string {
  const dir = vendorDir();
  const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${escapeStyle(read("openui-styles.css"))}</style>
<style>${escapeStyle(read("openui-dark.css"))}</style>
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0;overflow:hidden}body{background:var(--openui-background)}#root{padding:12px}</style>
</head><body><div id="root"></div>
<script>${escapeScript(read("openui-bundle.min.js"))}</script>
<script>${RENDERER_BOOT}</script>
</body></html>`;
}

// Runs inside the opaque-origin iframe. The parent is the only trusted sender:
// it posts {type:"openui:render", response, theme}; the frame reports ready,
// its content height, parse/runtime errors, and button actions back.
const RENDERER_BOOT = `(() => {
  const { React, createRoot, Renderer, openuiChatLibrary } = window.__OpenUI;
  const post = (msg) => parent.postMessage(msg, "*");
  const plain = (value) => { try { return JSON.parse(JSON.stringify(value ?? null)); } catch { return null; } };
  const root = createRoot(document.getElementById("root"));
  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || data.type !== "openui:render" || typeof data.response !== "string") return;
    document.body.classList.toggle("openui-dark", data.theme === "dark");
    document.documentElement.style.colorScheme = data.theme === "dark" ? "dark" : "light";
    root.render(React.createElement(Renderer, {
      response: data.response,
      library: openuiChatLibrary,
      onAction: (action) => post({ type: "openui:action", action: plain(action) }),
      onError: (errors) => post({ type: "openui:errors", errors: plain(errors) }),
    }));
  });
  let last = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(document.getElementById("root").getBoundingClientRect().height);
    if (height !== last) { last = height; post({ type: "openui:height", height }); }
  }).observe(document.getElementById("root"));
  post({ type: "openui:ready" });
})();`;

export default async function plugin(bb: BbPluginApi) {
  const html = rendererHtml();
  const etag = `"${createHash("sha256").update(html).digest("hex").slice(0, 32)}"`;

  bb.http.route("GET", "/renderer", (c) => {
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, { ETag: etag });
    return c.body(html, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache",
      ETag: etag,
    });
  });

  bb.rpc.register(rpcContract, {
    async loadSpec({ threadId, file, source }) {
      let rootPath: string;
      let hostId: string;
      if (source === "thread-storage") {
        const location = await bb.sdk.threads.storageLocation({ threadId });
        rootPath = location.storageRootPath;
        hostId = location.hostId;
      } else {
        const thread = await bb.sdk.threads.get({ threadId, include: "environment" });
        const environment = "environment" in thread ? thread.environment : null;
        if (!environment?.path || !environment.hostId) {
          throw new Error("This thread has no live workspace — openui needs one to read files.");
        }
        rootPath = environment.path;
        hostId = environment.hostId;
      }
      const absolute = path.resolve(rootPath, file);
      const relative = path.relative(path.resolve(rootPath), absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`"file" must not escape its source: ${file}`);
      }
      let read;
      try {
        read = await bb.sdk.files.read({ path: absolute, rootPath, hostId });
      } catch (error) {
        if (httpStatus(error) === 404) return { kind: "not-found" as const, file };
        throw error;
      }
      if (read.contentEncoding !== "utf8") throw new Error("OpenUI file is not UTF-8 text.");
      if (read.sizeBytes > MAX_SPEC_BYTES) {
        throw new Error(`OpenUI file is too large (${read.sizeBytes} bytes; max ${MAX_SPEC_BYTES}).`);
      }
      return { kind: "ok" as const, file, content: read.content };
    },
  });
}
