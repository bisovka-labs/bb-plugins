// bb-plugin-context-folder — attach an extra folder to a message as agent context.
//
// The folder travels as a plugin @-mention pill. At send time `resolve` turns
// it into an agent-only note with the absolute path and a short listing, so
// the agent knows where to look. It does not change the provider's sandbox:
// the agent reaches the folder with its normal file tools.
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const MENTION_PROVIDER = "folder";
const MAX_DIRS = 300;
const MAX_LISTING = 40;

const projectFolderSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  path: z.string(),
});
export type ProjectFolder = z.infer<typeof projectFolderSchema>;

export const rpcContract = defineRpcContract({
  projects: {
    input: z.null(),
    output: z.object({ projects: z.array(projectFolderSchema), home: z.string() }),
  },
  list_dirs: {
    input: z.object({ path: z.string().max(4096).nullable() }),
    output: z.object({
      path: z.string(),
      parent: z.string().nullable(),
      dirs: z.array(z.object({ name: z.string(), path: z.string() })),
      truncated: z.boolean(),
    }),
  },
});

/** Expands `~` and requires an absolute path on this machine. */
function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  const expanded =
    trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  if (!isAbsolute(expanded)) throw new Error(`Not an absolute path: ${raw}`);
  return resolve(expanded);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export default async function plugin(bb: BbPluginApi) {
  async function projectFolders(): Promise<ProjectFolder[]> {
    const projects = await bb.sdk.projects.list();
    const folders: ProjectFolder[] = [];
    for (const project of projects) {
      if (project.kind !== "standard") continue;
      // Only folders on this machine can be listed and handed to the agent.
      const sources = [...project.sources].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      for (const source of sources) {
        if (await isDirectory(source.path)) {
          folders.push({ projectId: project.id, name: project.name, path: source.path });
          break;
        }
      }
    }
    return folders.sort((a, b) => a.name.localeCompare(b.name));
  }

  bb.rpc.register(rpcContract, {
    projects: async () => ({ projects: await projectFolders(), home: homedir() }),
    list_dirs: async ({ path }) => {
      const dir = normalizePath(path ?? "~");
      const entries = await readdir(dir, { withFileTypes: true });
      const dirs = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => ({ name: entry.name, path: join(dir, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = dirname(dir);
      return {
        path: dir,
        parent: parent === dir ? null : parent,
        dirs: dirs.slice(0, MAX_DIRS),
        truncated: dirs.length > MAX_DIRS,
      };
    },
  });

  bb.ui.registerMentionProvider({
    id: MENTION_PROVIDER,
    label: "Context folders",
    async search({ query }) {
      const q = query.trim().toLowerCase();
      if (q === "") return [];
      return (await projectFolders())
        .filter((folder) => folder.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((folder) => ({ id: folder.path, title: folder.name, subtitle: folder.path, icon: "Folder" }));
    },
    async resolve(itemId) {
      const path = normalizePath(itemId);
      if (!(await isDirectory(path))) throw new Error(`Context folder not found: ${path}`);
      const entries = (await readdir(path, { withFileTypes: true }))
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      const listing = entries.slice(0, MAX_LISTING).join("\n");
      const more = entries.length > MAX_LISTING ? `\n… and ${entries.length - MAX_LISTING} more` : "";
      return {
        context: [
          `The user attached an extra context folder "${basename(path)}" for this conversation:`,
          path,
          "It may be outside your current workspace. Read and search it with absolute paths whenever it is relevant to the request.",
          "Top-level entries:",
          listing === "" ? "(empty)" : listing + more,
        ].join("\n"),
      };
    },
  });
}
