// bb-plugin-dictation-pause: pauses whatever is playing on this Mac while bb
// records dictation, and resumes it afterwards.
//
// media-control (brew install media-control) talks to macOS Now Playing, so it
// works for Spotify, Music, YouTube in a browser and anything else that shows
// up in Control Center. Resume only plays what this plugin paused itself.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const run = promisify(execFile);
const MEDIA_CONTROL = "/opt/homebrew/bin/media-control";

export const rpcContract = defineRpcContract({
  pause: { input: z.null(), output: z.object({ paused: z.boolean() }) },
  resume: { input: z.null(), output: z.object({ resumed: z.boolean() }) },
});

export default function plugin(bb: BbPluginApi) {
  let pausedByUs = false;
  // Start and stop can arrive back to back; handle them in order.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>) => {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  };

  async function isPlaying() {
    const { stdout } = await run(MEDIA_CONTROL, ["get", "--no-artwork"], { timeout: 5000 });
    const info = JSON.parse(stdout) as { playing?: boolean } | null;
    return info?.playing === true;
  }

  bb.rpc.register(rpcContract, {
    pause: () =>
      serial(async () => {
        if (pausedByUs || !(await isPlaying())) return { paused: false };
        await run(MEDIA_CONTROL, ["pause"], { timeout: 5000 });
        pausedByUs = true;
        bb.log.info("paused playback for dictation");
        return { paused: true };
      }),
    resume: () =>
      serial(async () => {
        if (!pausedByUs) return { resumed: false };
        pausedByUs = false;
        await run(MEDIA_CONTROL, ["play"], { timeout: 5000 });
        bb.log.info("resumed playback after dictation");
        return { resumed: true };
      }),
  });
}
