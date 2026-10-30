// Hide Empty Projects: a project with no active threads leaves the sidebar
// (bb's Thread list moves it into More through its hiddenGroups preference,
// and app.tsx hides it in More too) and comes back once a thread appears in
// it. Projects themselves stay, so they remain in the new-thread project
// picker and recent projects.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { plan, projectsWithRows, type SidebarThread, type State } from "./plan.ts";

const THREAD_LIST = "thread-list";
const STATE_KEY = "state";
const PAGE = 200;
const DEBOUNCE_MS = 1_500;
const SWEEP_MS = 5 * 60_000;
const STARTUP_MS = 5_000;

export const EMPTY_CHANGED = "empty-changed";

export const rpcContract = defineRpcContract({
  empty_projects: {
    input: z.null(),
    output: z.object({ projectIds: z.array(z.string()) }),
  },
});

const prefsSchema = z.object({
  preferences: z.object({ hiddenGroups: z.array(z.string()) }).passthrough(),
});

export default async function plugin(bb: BbPluginApi): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let again = false;
  let empty: string[] = [];

  bb.rpc.register(rpcContract, {
    empty_projects: () => ({ projectIds: empty }),
  });

  async function busyProjects(): Promise<Set<string>> {
    const threads: SidebarThread[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await bb.sdk.threads.list({ archived: false, limit: PAGE, offset });
      threads.push(...page);
      if (page.length < PAGE) return projectsWithRows(threads);
    }
  }

  async function sync(): Promise<void> {
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    const busy = await busyProjects();
    const { preferences } = await bb.sdk.plugins.callRpc({
      pluginId: THREAD_LIST,
      method: "listPreferences",
      outputSchema: prefsSchema,
    });
    const prev = (await bb.storage.kv.get<State>(STATE_KEY)) ?? null;
    const next = plan(
      projects.map((p) => p.id),
      busy,
      preferences.hiddenGroups,
      prev,
    );
    if (next.changed) {
      await bb.sdk.plugins.callRpc({
        pluginId: THREAD_LIST,
        method: "setPreference",
        input: { key: "hiddenGroups", value: next.hiddenGroups },
        outputSchema: z.unknown(),
      });
      bb.log.info(`hide-empty-projects: hiddenGroups ${preferences.hiddenGroups.length} → ${next.hiddenGroups.length}`);
    }
    await bb.storage.kv.set(STATE_KEY, next.state);
    const nextEmpty = projects.map((p) => p.id).filter((id) => !busy.has(id)).sort();
    if (nextEmpty.join() !== empty.join()) {
      empty = nextEmpty;
      bb.realtime.publish(EMPTY_CHANGED, {});
    }
  }

  function run(): void {
    if (running) {
      again = true;
      return;
    }
    running = sync()
      .catch((error) => bb.log.error(`hide-empty-projects: ${String(error)}`))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          run();
        }
      });
  }

  function schedule(ms = DEBOUNCE_MS): void {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  for (const event of ["thread.created", "thread.archived", "thread.unarchived", "thread.deleted"] as const) {
    bb.events.on(event, () => schedule());
  }
  const sweep = setInterval(run, SWEEP_MS);
  bb.onDispose(() => {
    clearTimeout(timer);
    clearInterval(sweep);
  });
  schedule(STARTUP_MS);
}
