// Short Titles: names threads in one or two words. It registers an AI service
// for bb's thread-title task and, when a new thread is still untitled a minute
// later (model was cold, endpoint was down), asks bb to title it again.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { cleanTitle, systemPrompt, titleContext } from "./titles.ts";

const SERVICE_ID = "short";
const RETRY_FACTORS = [1, 3];

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    baseUrl: {
      type: "string",
      label: "Endpoint",
      description: "OpenAI-совместимый адрес с /v1. По умолчанию локальная Ollama.",
      default: "http://127.0.0.1:11434/v1",
    },
    model: {
      type: "string",
      label: "Модель",
      description: "Небольшая быстрая модель: bb ждёт название не дольше 5 секунд.",
      default: "qwen3.5:4b",
    },
    apiKey: { type: "string", label: "API key", description: "Нужен только облачным endpoint.", secret: true },
    maxWords: { type: "number", label: "Максимум слов", default: 3 },
    retrySeconds: {
      type: "number",
      label: "Повтор, секунд",
      description: "Через сколько секунд назвать тред заново, если он остался без названия. 0 выключает.",
      default: 60,
    },
  });

  async function chat(system: string | null, user: string, signal: AbortSignal): Promise<string> {
    const { baseUrl, model, apiKey } = await settings.get();
    const url = `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
    const messages = [...(system === null ? [] : [{ role: "system", content: system }]), { role: "user", content: user }];
    const post = (extra: Record<string, unknown>) =>
      fetch(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...(typeof apiKey === "string" && apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages, temperature: 0.2, ...extra }),
      });
    // Reasoning models spend the 5 seconds thinking; endpoints that do not
    // know the field reject it, so fall back to a plain request.
    let response = await post({ reasoning_effort: "none" });
    if (response.status === 400) response = await post({});
    if (!response.ok) {
      throw new Error(`${url} answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  }

  bb.experimental_aiServices.register({
    id: SERVICE_ID,
    displayName: "Short Titles",
    complete: async (prompt, { signal }) => {
      const context = titleContext(prompt);
      if (context === null) return chat(null, prompt, signal);
      const maxWords = Math.max(1, Math.round((await settings.get()).maxWords));
      const title = cleanTitle(await chat(systemPrompt(maxWords), context, signal), maxWords);
      if (title.length === 0) throw new Error("the model returned an empty title");
      return title;
    },
  });

  const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  const clear = (threadId: string) => {
    timers.get(threadId)?.forEach(clearTimeout);
    timers.delete(threadId);
  };
  bb.onDispose(() => [...timers.keys()].forEach(clear));

  async function retitle(threadId: string): Promise<void> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.title || thread.archivedAt !== null) return clear(threadId);
    const updated = await bb.sdk.threads.experimental_regenerateTitle({ threadId });
    bb.log.info(`short-titles: titled ${threadId} «${updated.title ?? ""}» on retry`);
    clear(threadId);
  }

  bb.events.on("thread.created", async ({ thread }) => {
    const { retrySeconds } = await settings.get();
    if (retrySeconds <= 0 || thread.title || timers.has(thread.id)) return;
    timers.set(
      thread.id,
      RETRY_FACTORS.map((factor) =>
        setTimeout(() => {
          retitle(thread.id).catch((error) => bb.log.warn(`short-titles ${thread.id}: ${String(error)}`));
        }, retrySeconds * factor * 1000),
      ),
    );
  });
  bb.events.on("thread.deleted", ({ thread }) => clear(thread.id));
}
