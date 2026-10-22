import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Largest file the browser path will download through RPC. */
export const MAX_READ_BYTES = 100 * 1024 * 1024;
/** Bytes per read: host output is capped at 8 MiB, and base64 adds a third. */
export const READ_CHUNK_BYTES = 4 * 1024 * 1024;

const candidates = z.array(z.string().min(1).max(4096)).min(1).max(8);

/** server.ts → host.ts. Both methods act on the first existing candidate. */
export const hostContract = defineRpcContract({
  // Put the file on this Mac's clipboard.
  copyFile: {
    input: z.object({ candidates }).strict(),
    output: z.object({ path: z.string().nullable() }).strict(),
  },
  // Return one chunk of the file's bytes for a browser to copy, share or download.
  readFile: {
    input: z.object({ candidates, offset: z.number().int().min(0) }).strict(),
    output: z
      .object({ path: z.string(), size: z.number(), base64: z.string() })
      .strict()
      .or(z.object({ path: z.null(), tooLarge: z.boolean() }).strict()),
  },
});

const fileContext = z
  .object({
    path: z.string().min(1).max(4096),
    copyPath: z.string().max(4096).nullable(),
    environmentId: z.string().max(200).nullable(),
    threadId: z.string().max(200).nullable(),
  })
  .strict();

/** app.tsx → server.ts: what the file viewer knows about the open file. */
export const rpcContract = defineRpcContract({
  copy_file: {
    input: fileContext,
    output: z.object({ path: z.string() }).strict(),
  },
  read_file: {
    input: fileContext.extend({ offset: z.number().int().min(0) }),
    output: z.object({ name: z.string(), mimeType: z.string(), size: z.number(), base64: z.string() }).strict(),
  },
});
