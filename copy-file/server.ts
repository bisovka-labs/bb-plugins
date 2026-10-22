// bb-plugin-copy-file — resolves the file open in bb's viewer to an absolute
// path on this Mac, then either puts it on the Mac's clipboard (desktop app)
// or returns its bytes (browser).
import { posix } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, MAX_READ_BYTES, rpcContract } from "./contract.js";

type FileContext = { path: string; copyPath: string | null; environmentId: string | null; threadId: string | null };

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip",
  json: "application/json",
  csv: "text/csv",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  /** Absolute paths the viewer's file may live at, most likely first. */
  async function locate({ path, copyPath, environmentId, threadId }: FileContext) {
    const { primaryHostId } = await bb.sdk.system.config();
    if (primaryHostId === null) throw new Error("This Mac is not enrolled as a bb host");

    // The viewer shows workspace files worktree-relative and thread-storage
    // files storage-relative; host files and most copy paths are absolute.
    const candidates: string[] = [];
    for (const known of [copyPath, path]) {
      if (known?.startsWith("/")) candidates.push(known);
    }
    if (!path.startsWith("/")) {
      const thread = threadId === null ? null : await bb.sdk.threads.get({ threadId }).catch(() => null);
      const envId = environmentId ?? thread?.environmentId ?? null;
      if (envId !== null) {
        const env = await bb.sdk.environments.get({ environmentId: envId }).catch(() => null);
        if (env?.path && env.hostId === primaryHostId) candidates.push(posix.join(env.path, path));
      }
      if (threadId !== null) {
        const storage = await bb.sdk.threads.storageLocation({ threadId }).catch(() => null);
        if (storage?.hostId === primaryHostId) candidates.push(posix.join(storage.storageRootPath, path));
      }
    }
    if (candidates.length === 0) throw new Error(`Cannot locate ${path} on this Mac`);
    return { hostId: primaryHostId, candidates };
  }

  bb.rpc.register(rpcContract, {
    copy_file: async (context) => {
      const { hostId, candidates } = await locate(context);
      const result = await host.call("copyFile", { candidates }, { hostId });
      if (result.path === null) throw new Error(`File not found on this Mac: ${context.path}`);
      return { path: result.path };
    },
    read_file: async (context) => {
      const { hostId, candidates } = await locate(context);
      const result = await host.call("readFile", { candidates, offset: context.offset }, { hostId });
      if (result.path === null) {
        throw new Error(
          "tooLarge" in result && result.tooLarge
            ? `File is larger than ${MAX_READ_BYTES / 1024 / 1024} MB`
            : `File not found on this Mac: ${context.path}`,
        );
      }
      const name = posix.basename(result.path);
      const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
      const mimeType = MIME_TYPES[extension] ?? "application/octet-stream";
      return { name, mimeType, size: result.size, base64: result.base64 };
    },
  });
}
