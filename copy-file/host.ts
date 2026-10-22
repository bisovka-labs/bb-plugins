// Runs on the Mac itself: NSPasteboard is the only way to put a file (not its
// text) on the clipboard, the same thing Finder's ⌘C does.
import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, MAX_READ_BYTES, READ_CHUNK_BYTES } from "./contract.js";

const run = promisify(execFile);

const COPY_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  const url = $.NSURL.fileURLWithPath(argv[0]);
  if (!pasteboard.writeObjects($.NSArray.arrayWithObject(url))) throw new Error("pasteboard write failed");
}`;

/** First candidate that is an existing regular file, with its size. */
async function firstFile(candidates: string[]): Promise<{ path: string; size: number } | null> {
  for (const path of candidates) {
    if (!path.startsWith("/")) continue;
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) return { path, size: info.size };
  }
  return null;
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    copyFile: async ({ candidates }, context) => {
      if (process.platform !== "darwin") throw new Error("Copy file works only on macOS");
      const file = await firstFile(candidates);
      if (!file) return { path: null };
      await run("osascript", ["-l", "JavaScript", "-e", COPY_SCRIPT, file.path], { signal: context.signal });
      return { path: file.path };
    },
    readFile: async ({ candidates, offset }) => {
      const file = await firstFile(candidates);
      if (!file) return { path: null, tooLarge: false };
      if (file.size > MAX_READ_BYTES) return { path: null, tooLarge: true };
      const handle = await open(file.path, "r");
      try {
        const buffer = Buffer.alloc(Math.max(0, Math.min(READ_CHUNK_BYTES, file.size - offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        return { path: file.path, size: file.size, base64: buffer.subarray(0, bytesRead).toString("base64") };
      } finally {
        await handle.close();
      }
    },
  },
});
