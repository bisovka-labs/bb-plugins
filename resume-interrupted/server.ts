// Resume Interrupted: after BB restarts, threads whose turn the host daemon
// restart cut off (the red ⊗ in the sidebar) get «продолжи» sent to them.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { RESUME_PROMPT, shouldResume, type LatestEvent } from "./resume.ts";

// The daemon reconnects and core writes the interrupt events a little after
// the server loads plugins, so the startup sweep runs a few times.
const SWEEP_DELAYS_MS = [10_000, 60_000, 180_000];
// thread.failed fires as the thread lands in error; the interrupt event follows.
const FAILED_DELAY_MS = 3_000;
const PAGE = 200;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const inFlight = new Set<string>();
  const later = (ms: number, fn: () => Promise<void>) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn().catch((error) => bb.log.error(`resume-interrupted: ${String(error)}`));
    }, ms);
    timers.add(timer);
  };
  bb.onDispose(() => timers.forEach(clearTimeout));

  async function check(threadId: string): Promise<void> {
    if (inFlight.has(threadId)) return;
    inFlight.add(threadId);
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      const [latest] = (await bb.sdk.threads.events.list({
        threadId,
        order: "desc",
        limit: "1",
        types: ["system/thread/interrupted", "turn/started"],
      })) as LatestEvent[];
      if (!shouldResume(thread, latest, Date.now())) return;
      // One «продолжи» per interruption, even across reloads.
      const key = `resumed:${threadId}`;
      if ((await bb.storage.kv.get<string>(key)) === latest!.id) return;
      await bb.storage.kv.set(key, latest!.id);
      await bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text: RESUME_PROMPT, mentions: [] }],
      });
      bb.log.info(`resume-interrupted: sent «${RESUME_PROMPT}» to ${threadId} (${thread.title ?? "untitled"})`);
    } finally {
      inFlight.delete(threadId);
    }
  }

  async function sweep(): Promise<void> {
    for (let offset = 0; ; offset += PAGE) {
      const page = await bb.sdk.threads.list({ archived: false, limit: PAGE, offset });
      for (const thread of page) {
        if (thread.status !== "error") continue;
        await check(thread.id).catch((error) => bb.log.error(`resume-interrupted ${thread.id}: ${String(error)}`));
      }
      if (page.length < PAGE) return;
    }
  }

  bb.events.on("thread.failed", ({ thread }) => later(FAILED_DELAY_MS, () => check(thread.id)));
  for (const ms of SWEEP_DELAYS_MS) later(ms, sweep);
}
