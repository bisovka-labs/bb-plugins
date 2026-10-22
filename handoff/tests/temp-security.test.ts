import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BbPluginApi } from "@bb/plugin-sdk";
import { hostExec } from "../adopt/remote";
import { deliverPatch } from "../machines";

describe("private handoff files", () => {
  it("keeps remote output private even with umask 022 and removes its directory", async () => {
    let output = "";
    let outputMode = 0;
    let directoryMode = 0;
    const bb = {
      sdk: {
        terminals: {
          create: async ({ start }: { start: { command: string } }) => {
            execFileSync("/bin/sh", ["-c", `umask 022; ${start.command}`]);
            return { id: "test" };
          },
          get: async () => ({ status: "exited" }),
          close: async () => {},
        },
        files: {
          read: async ({ path }: { path: string }) => {
            output = path;
            outputMode = (await stat(path)).mode & 0o777;
            directoryMode = (await stat(join(path, ".."))).mode & 0o777;
            return { contentEncoding: "utf8", content: await readFile(path, "utf8") };
          },
          remove: async ({ path, recursive }: { path: string; recursive?: boolean }) => rm(path, { force: true, recursive }),
        },
      },
    } as unknown as BbPluginApi;
    expect(await hostExec(bb, "test", "printf synthetic-private-transcript")).toBe("synthetic-private-transcript");
    expect(outputMode).toBe(0o600);
    expect(directoryMode).toBe(0o700);
    await expect(stat(join(output, ".."))).rejects.toThrow();
  });

  it("creates patches with owner-only access and a create-only guard", async () => {
    const root = await mkdtemp(join(tmpdir(), "handoff-security-"));
    const writes: { path: string; mode?: number; expectedSha256?: string | null }[] = [];
    const bb = {
      sdk: { files: { write: async (args: typeof writes[number] & { content: string }) => {
        writes.push(args);
        await writeFile(join(root, "patch"), args.content, { mode: args.mode });
        return { outcome: "written" };
      } } },
    } as unknown as BbPluginApi;
    try {
      const path = await deliverPatch(bb, { hostId: "test", sourceThreadId: "thr_source", patch: "synthetic-private-patch" });
      expect(path).not.toBe("/tmp/bb-handoff-thr_source.patch");
      expect(writes[0].mode).toBe(0o600);
      expect(writes[0].expectedSha256).toBeNull();
      expect((await stat(join(root, "patch"))).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not follow a precreated remote output directory symlink", async () => {
    const target = await mkdtemp(join(tmpdir(), "handoff-symlink-target-"));
    let planted = "";
    const bb = {
      sdk: {
        terminals: {
          create: async ({ start }: { start: { command: string } }) => {
            const directory = start.command.match(/mkdir -m 700 '([^']+)'/)?.[1];
            expect(directory).toBeTruthy();
            planted = directory!;
            await symlink(target, planted);
            try { execFileSync("/bin/sh", ["-c", start.command], { stdio: "pipe" }); } catch {}
            return { id: "test" };
          },
          get: async () => ({ status: "exited" }),
          close: async () => {},
        },
        files: {
          read: async ({ path }: { path: string }) => ({ contentEncoding: "utf8", content: await readFile(path, "utf8") }),
          remove: async () => {},
        },
      },
    } as unknown as BbPluginApi;
    try {
      expect(await hostExec(bb, "test", "printf must-not-be-written")).toBeNull();
      await expect(stat(join(target, "output"))).rejects.toThrow();
      await expect(stat(join(target, "output.part"))).rejects.toThrow();
    } finally {
      if (planted) await rm(planted, { force: true });
      await rm(target, { recursive: true, force: true });
    }
  });
});
