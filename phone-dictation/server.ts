// bb-plugin-phone-dictation: one press of the iPhone Action button starts a new
// bb thread from speech.
//
// The phone runs a Shortcut that records audio and POSTs it here over the
// tailnet (`tailscale serve` on port 18080 forwards to the bb server). This route
// transcribes it with whatever voice service bb uses for the prompt box
// (`bb settings ai-services`), spawns a thread with the transcript as its prompt and
// answers with the thread's getbb.app URL, which the Shortcut then opens.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const PERSONAL_PROJECT = "proj_personal";

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    project: { type: "project", label: "Проект для новых сессий (пусто — Personal)" },
    appUrl: {
      type: "string",
      label: "Адрес bb для ссылки на сессию, например https://<имя>.getbb.app",
      default: "",
    },
  });

  bb.http.route(
    "POST",
    "/new",
    async (c) => {
      const { project, appUrl } = await settings.get();
      const projectId = c.req.query("project") || (typeof project === "string" && project) || PERSONAL_PROJECT;

      const type = c.req.header("content-type") ?? "";
      const body = await c.req.arrayBuffer();
      if (body.byteLength === 0) return c.text("пустой запрос: нет ни аудио, ни текста", 400);

      let prompt: string;
      if (type.startsWith("text/")) {
        prompt = new TextDecoder().decode(body);
      } else {
        const file = new File([body], "dictation.m4a", { type: type || "audio/mp4" });
        prompt = (await bb.sdk.system.transcribeVoice({ file })).text;
      }
      prompt = prompt.trim();
      if (!prompt) return c.text("не расслышал: расшифровка пустая", 422);

      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        prompt,
      });
      bb.log.info(`spawned ${thread.id} in ${projectId} (${prompt.length} chars)`);

      const path =
        thread.projectId === PERSONAL_PROJECT
          ? `/threads/${thread.id}`
          : `/projects/${thread.projectId}/threads/${thread.id}`;
      return c.text(appUrl.replace(/\/+$/, "") + path);
    },
    { auth: "token" },
  );
}
