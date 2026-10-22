// Watches bb's composer for an active voice recording. While bb records, the
// composer shows a "Cancel recording" button; once recording stops it turns
// into "Cancel transcription" or disappears. That covers the mic button,
// keyboard shortcuts and every composer in the window.
import { useEffect } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

const RECORDING = 'button[aria-label="Cancel recording"]';

function DictationPause() {
  const rpc = useRpc<typeof rpcContract>();

  useEffect(() => {
    let recording = false;
    let frame = 0;
    const call = (method: "pause" | "resume") =>
      rpc.call(method, null).catch((error: unknown) => console.warn(`[dictation-pause] ${method} failed`, error));

    const sync = () => {
      frame = 0;
      const now = document.querySelector(RECORDING) !== null;
      if (now === recording) return;
      recording = now;
      void call(now ? "pause" : "resume");
    };
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(sync);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    sync();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (recording) void call("resume");
    };
  }, [rpc]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "dictation-pause", component: DictationPause });
});
