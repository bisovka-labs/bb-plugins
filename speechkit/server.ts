import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";

const here = dirname(fileURLToPath(import.meta.url));
const root = basename(here) === "dist" ? dirname(here) : here;
const python = join(root, ".venv/bin/python");

function recognize(payload: unknown, signal: AbortSignal, pending: Set<ChildProcess>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [join(root, "speechkit.py")], { stdio: ["pipe", "pipe", "pipe"], signal });
    pending.add(child);
    child.once("close", () => pending.delete(child));
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; if (stdout.length > 1_000_000) child.kill(); });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => reject(new Error("SpeechKit worker could not start or was cancelled")));
    child.on("close", (code) => {
      try {
        const result = JSON.parse(stdout);
        if (code !== 0 || typeof result.text !== "string") reject(new Error(result.error || "SpeechKit recognition failed"));
        else resolve(result.text);
      } catch { reject(new Error("SpeechKit worker returned an invalid response")); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export default function plugin(bb: BbPluginApi) {
  const pending = new Set<ChildProcess>();
  bb.onDispose(() => { for (const child of pending) child.kill(); });
  const settings = bb.settings.define({
    apiKey: { type: "string", label: "Yandex SpeechKit API key", secret: true },
    folderId: { type: "string", label: "Yandex Cloud folder ID (optional for service account key)", default: "" },
    language: { type: "select", label: "Recognition language", options: ["ru-RU", "en-US", "auto"], default: "ru-RU" },
  });
  async function status() {
    const config = await settings.get();
    let runtimeReady = true;
    try { await access(python, constants.X_OK); }
    catch { runtimeReady = false; }
    if (!config.apiKey?.trim()) return { ready: false, message: "Add a Yandex SpeechKit API key in plugin settings" };
    if (!runtimeReady) return { ready: false, message: "Install Python dependencies using the plugin README" };
    return { ready: true, message: "Configured; API access is verified by transcription" };
  }
  bb.experimental_aiServices.register({
    id: "speechkit", displayName: "Yandex SpeechKit v3", status,
    async transcribe(audio, { signal }) {
      const config = await settings.get();
      if (!config.apiKey?.trim()) throw new Error("Yandex SpeechKit API key is missing");
      if (!audio.size || audio.size > 20 * 1024 * 1024) throw new Error("SpeechKit accepts non-empty recordings up to 20 MB");
      return recognize({ apiKey: config.apiKey, folderId: config.folderId, language: config.language,
        audio: Buffer.from(await audio.arrayBuffer()).toString("base64") }, signal, pending);
    },
  });
  bb.cli.register(defineCli({
    name: "speechkit", summary: "Configure Yandex SpeechKit voice input",
    commands: {
      status: cliCommand({ summary: "Show configuration readiness without exposing credentials",
        async run() { return { exitCode: 0, stdout: JSON.stringify(await status()) }; } }),
      configure: cliCommand({
        summary: "Save an API key through stdin into BB secret storage",
        options: { "api-key": { type: "string", stdin: true, required: true, description: "Service account API key; use --api-key-stdin" } },
        async run(input) {
          const key = input.options["api-key"].trim();
          if (!key || /\s/.test(key)) throw new Error("API key must be a non-empty value without whitespace");
          await settings.experimental_set({ apiKey: key });
          return { exitCode: 0, stdout: "API key saved in BB secret storage. Use a transcription to verify access." };
        },
      }),
    },
  }));
}
