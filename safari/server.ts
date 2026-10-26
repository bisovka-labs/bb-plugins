// bb-plugin-safari — lets agents drive the user's real Safari (their tabs,
// cookies, and logins) through AppleScript: agent tools plus `bb safari`.
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginAgentToolResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  SafariError,
  closeTab,
  describeTab,
  evaluate,
  isRunning,
  javascriptAllowed,
  listTabs,
  openUrl,
  readTab,
  screenshot,
  selectTab,
  type TabInfo,
  type TabRef,
} from "./safari.ts";

const MAX_CHARS_DEFAULT = 20_000;
const MAX_CHARS_LIMIT = 200_000;

const refShape = {
  window: z
    .number()
    .int()
    .optional()
    .describe("Window id from safari_tabs; defaults to the front Safari window"),
  tab: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based tab index in that window; defaults to its current tab"),
};

function formatTab(tab: TabInfo): string {
  return `${tab.current ? "*" : " "} window ${tab.window} tab ${tab.tab}  ${tab.title || "(untitled)"}\n    ${tab.url}`;
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated: ${text.length - maxChars} more characters; raise maxChars or read a narrower part with safari_js]`;
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

// Page helpers for click/fill. They run in the page, so they only see the
// DOM: events are synthetic (isTrusted false), which most sites accept.
const FIND_ELEMENT = `
const find = (selector, text) => {
  if (selector) return document.querySelector(selector);
  const wanted = text.trim().toLowerCase();
  const candidates = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], [role=link], [role=tab], [role=menuitem], label, summary')];
  const visible = (el) => el.getClientRects().length > 0;
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
  return candidates.find((el) => visible(el) && label(el) === wanted)
    || candidates.find((el) => visible(el) && label(el).includes(wanted));
};
const describe = (el) => '<' + el.tagName.toLowerCase() + '> ' + (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
`;

function clickScript(selector: string | undefined, text: string | undefined) {
  return `${FIND_ELEMENT}
const el = find(${JSON.stringify(selector ?? "")}, ${JSON.stringify(text ?? "")});
if (!el) throw new Error('No element matches ' + ${JSON.stringify(selector ?? `text "${text}"`)});
el.scrollIntoView({ block: 'center' });
el.focus?.();
for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
}
el.click();
return 'Clicked ' + describe(el);`;
}

function fillScript(selector: string, value: string, submit: boolean) {
  return `
const el = document.querySelector(${JSON.stringify(selector)});
if (!el) throw new Error('No element matches ' + ${JSON.stringify(selector)});
el.scrollIntoView({ block: 'center' });
el.focus();
const value = ${JSON.stringify(value)};
if (el.isContentEditable) {
  el.textContent = value;
} else if (el.tagName === 'SELECT') {
  const option = [...el.options].find((o) => o.value === value || o.text.trim() === value);
  if (!option) throw new Error('No option ' + value);
  el.value = option.value;
} else if (el.type === 'checkbox' || el.type === 'radio') {
  const on = !['false', '0', 'off', ''].includes(value.toLowerCase());
  if (el.checked !== on) el.click();
} else {
  // Native setter so React and similar frameworks see the change.
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
}
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
if (${submit}) {
  if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
  else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
}
return 'Filled ' + el.tagName.toLowerCase() + (el.name ? '[name=' + el.name + ']' : '');`;
}

/** Turns SafariError into a tool error the agent can act on. */
async function tool(
  work: () => Promise<PluginAgentToolResult>,
): Promise<PluginAgentToolResult> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof SafariError)) throw error;
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
}

export default async function plugin(bb: BbPluginApi) {
  if (process.platform !== "darwin") {
    bb.log.warn("Safari control needs the BB server to run on macOS");
    return;
  }

  bb.agents.registerTool({
    name: "safari_tabs",
    description:
      "List the user's open Safari windows and tabs (window id, tab index, title, URL; * marks each window's current tab).",
    instructions:
      "When the user asks to do something in Safari («в сафари», «открой в сафари»), use the safari_* tools: they drive the user's real Safari " +
      "with their logins. Start with safari_tabs, open pages with safari_open (a new tab by default, never replace the user's tab unless asked), " +
      "read with safari_read, act with safari_click / safari_fill / safari_js, and check with safari_screenshot. " +
      "Do not submit purchases, payments, messages, or irreversible forms without the user's explicit go-ahead.",
    presentation: {
      label: { pending: "Listing Safari tabs", completed: "Listed Safari tabs" },
    },
    parameters: z.object({}),
    async execute() {
      return tool(async () => {
        const tabs = await listTabs();
        if (tabs.length === 0) {
          return (await isRunning())
            ? "Safari has no open tabs."
            : "Safari is not running. safari_open starts it.";
        }
        return tabs.map(formatTab).join("\n");
      });
    },
  });

  bb.agents.registerTool({
    name: "safari_open",
    description:
      "Open a URL in Safari and wait for it to load. Opens a new tab in the front window by default; " +
      "newTab=false navigates the given (or current) tab instead.",
    presentation: {
      label: { pending: "Opening page in Safari", completed: "Opened page in Safari" },
    },
    parameters: z.object({
      url: z.string().min(1).describe("Absolute URL, e.g. https://example.com"),
      newTab: z.boolean().optional().describe("Default true"),
      ...refShape,
    }),
    async execute({ url, newTab, window, tab }) {
      return tool(async () => {
        const opened = await openUrl(url, {
          newTab: newTab ?? true,
          window,
          tab,
        });
        return `Opened\n${formatTab(opened)}`;
      });
    },
  });

  bb.agents.registerTool({
    name: "safari_select",
    description:
      "Make a Safari tab the current tab of its window and bring the window forward. activate=true also brings Safari in front of other apps.",
    presentation: {
      label: { pending: "Switching Safari tab", completed: "Switched Safari tab" },
    },
    parameters: z.object({
      ...refShape,
      activate: z.boolean().optional().describe("Bring Safari to the front; default false"),
    }),
    async execute({ window, tab, activate }) {
      return tool(async () =>
        formatTab(await selectTab({ window, tab }, activate ?? false)),
      );
    },
  });

  bb.agents.registerTool({
    name: "safari_read",
    description:
      "Read a Safari tab: its visible text (default) or full HTML source, with title and URL. Works without JavaScript access.",
    presentation: {
      label: { pending: "Reading Safari page", completed: "Read Safari page" },
    },
    parameters: z.object({
      ...refShape,
      format: z.enum(["text", "html"]).optional().describe("Default text"),
      maxChars: z
        .number()
        .int()
        .min(100)
        .max(MAX_CHARS_LIMIT)
        .optional()
        .describe(`Default ${MAX_CHARS_DEFAULT}`),
    }),
    async execute({ window, tab, format, maxChars }) {
      return tool(async () => {
        const ref = { window, tab };
        const info = await describeTab(ref);
        const content = await readTab(ref, format ?? "text");
        return `${formatTab(info)}\n\n${clip(content, maxChars ?? MAX_CHARS_DEFAULT)}`;
      });
    },
  });

  bb.agents.registerTool({
    name: "safari_js",
    description:
      "Run JavaScript in a Safari tab and return the JSON of its result. `code` is the body of an async function: " +
      "use `return` for the result and `await` freely, e.g. `return [...document.querySelectorAll('h2')].map(h => h.innerText)`. " +
      "Needs «Allow JavaScript from Apple Events» in Safari; the error explains how to enable it.",
    presentation: {
      label: { pending: "Running script in Safari", completed: "Ran script in Safari" },
    },
    parameters: z.object({
      code: z.string().min(1).describe("Async function body; `return` the result"),
      ...refShape,
      timeoutMs: z
        .number()
        .int()
        .min(100)
        .max(120_000)
        .optional()
        .describe("Default 15000"),
      maxChars: z.number().int().min(100).max(MAX_CHARS_LIMIT).optional(),
    }),
    async execute({ code, window, tab, timeoutMs, maxChars }) {
      return tool(async () => {
        const value = await evaluate({ window, tab }, code, timeoutMs ?? 15_000);
        return clip(stringify(value), maxChars ?? MAX_CHARS_DEFAULT);
      });
    },
  });

  bb.agents.registerTool({
    name: "safari_click",
    description:
      "Click an element in a Safari tab, found by CSS selector or by its visible text (links, buttons, tabs, labels). Needs JavaScript access.",
    presentation: {
      label: { pending: "Clicking in Safari", completed: "Clicked in Safari" },
    },
    parameters: z
      .object({
        selector: z.string().min(1).optional().describe("CSS selector"),
        text: z
          .string()
          .min(1)
          .optional()
          .describe("Visible text of a link or button; exact match preferred, then substring"),
        ...refShape,
      })
      .refine((p) => (p.selector === undefined) !== (p.text === undefined), {
        message: "Pass exactly one of selector or text",
      }),
    async execute({ selector, text, window, tab }) {
      return tool(async () =>
        stringify(await evaluate({ window, tab }, clickScript(selector, text), 10_000)),
      );
    },
  });

  bb.agents.registerTool({
    name: "safari_fill",
    description:
      "Set the value of an input, textarea, select, checkbox, or contenteditable in a Safari tab by CSS selector, " +
      "firing input/change events; submit=true then submits its form. Needs JavaScript access.",
    presentation: {
      label: { pending: "Filling a field in Safari", completed: "Filled a field in Safari" },
    },
    parameters: z.object({
      selector: z.string().min(1).describe("CSS selector of the field"),
      value: z
        .string()
        .describe("Text, option value or label, or true/false for a checkbox"),
      submit: z.boolean().optional().describe("Submit the form afterwards; default false"),
      ...refShape,
    }),
    async execute({ selector, value, submit, window, tab }) {
      return tool(async () =>
        stringify(
          await evaluate(
            { window, tab },
            fillScript(selector, value, submit ?? false),
            10_000,
          ),
        ),
      );
    },
  });

  bb.agents.registerTool({
    name: "safari_screenshot",
    description:
      "Screenshot a Safari window showing the given tab. Briefly brings Safari to the front (macOS does not render covered windows), then returns focus.",
    presentation: {
      label: { pending: "Taking Safari screenshot", completed: "Took Safari screenshot" },
    },
    parameters: z.object({
      ...refShape,
      maxSize: z
        .number()
        .int()
        .min(400)
        .max(3000)
        .optional()
        .describe("Longest side in pixels; default 1600"),
    }),
    async execute({ window, tab, maxSize }) {
      return tool(async () => {
        const shot = await screenshot({ window, tab }, maxSize ?? 1600);
        return {
          content: [
            { type: "text", text: `${formatTab(shot.tab)}\nSaved ${shot.path}` },
            { type: "image", data: shot.base64, mimeType: "image/jpeg" },
          ],
        };
      });
    },
  });

  bb.agents.registerTool({
    name: "safari_close",
    description: "Close a Safari tab. Close only tabs you opened unless the user asks otherwise.",
    presentation: {
      label: { pending: "Closing Safari tab", completed: "Closed Safari tab" },
    },
    parameters: z.object(refShape),
    async execute({ window, tab }) {
      return tool(async () => `Closed\n${formatTab(await closeTab({ window, tab }))}`);
    },
  });

  // ---- `bb safari` CLI ------------------------------------------------------

  const refOptions = {
    window: { type: "integer", min: 0, max: 2 ** 31, description: "Window id from `bb safari tabs`; default front window" },
    tab: { type: "integer", min: 1, max: 10_000, description: "1-based tab index; default the window's current tab" },
  } as const;
  const toRef = (o: { window?: number; tab?: number }): TabRef => ({
    window: o.window,
    tab: o.tab,
  });
  async function cli(work: () => Promise<string>) {
    try {
      return { exitCode: 0, stdout: await work() };
    } catch (error) {
      if (!(error instanceof SafariError)) throw error;
      throw new PluginCliError(error.message, { code: "safari_error" });
    }
  }

  bb.cli.register(
    defineCli({
      name: "safari",
      summary: "Drive the user's Safari: tabs, open, read, run JavaScript, screenshot",
      commands: {
        status: cliCommand({
          summary: "Check that BB can control Safari and run JavaScript in it",
          async run() {
            return cli(async () => {
              if (!(await isRunning())) return "Safari is not running.";
              const tabs = await listTabs();
              const js = await javascriptAllowed();
              return [
                `Automation: ok (${tabs.length} tabs)`,
                `JavaScript: ${js === true ? "ok" : js === false ? "off — Safari → Settings → Developer → «Allow JavaScript from Apple Events»" : "unknown (no open tab)"}`,
              ].join("\n");
            });
          },
        }),
        tabs: cliCommand({
          summary: "List windows and tabs",
          async run() {
            return cli(async () => {
              const tabs = await listTabs();
              return tabs.length === 0 ? "No Safari tabs." : tabs.map(formatTab).join("\n");
            });
          },
        }),
        open: cliCommand({
          summary: "Open a URL in a new tab (or --here in the current one)",
          positionals: [{ name: "url", description: "Absolute URL", required: true }],
          options: {
            here: { type: "boolean", description: "Navigate the current tab instead of opening a new one" },
            ...refOptions,
          },
          async run(input) {
            return cli(async () =>
              formatTab(
                await openUrl(input.positionals.url, {
                  newTab: input.options.here !== true,
                  window: input.options.window,
                  tab: input.options.tab,
                }),
              ),
            );
          },
        }),
        read: cliCommand({
          summary: "Print a tab's text (or --html source)",
          options: {
            html: { type: "boolean", description: "Print HTML source instead of text" },
            ...refOptions,
          },
          async run(input) {
            return cli(() =>
              readTab(toRef(input.options), input.options.html === true ? "html" : "text").then(
                (text) => clip(text, 900_000),
              ),
            );
          },
        }),
        js: cliCommand({
          summary: "Run an async function body in a tab and print the JSON result",
          positionals: [{ name: "code", description: "Function body; use return", required: true }],
          options: refOptions,
          async run(input) {
            return cli(async () =>
              clip(stringify(await evaluate(toRef(input.options), input.positionals.code, 30_000)), 900_000),
            );
          },
        }),
        screenshot: cliCommand({
          summary: "Save a JPEG of a tab's window and print its path",
          options: refOptions,
          async run(input) {
            return cli(async () => (await screenshot(toRef(input.options), 1600)).path);
          },
        }),
        close: cliCommand({
          summary: "Close a tab",
          options: refOptions,
          async run(input) {
            return cli(async () => `Closed\n${formatTab(await closeTab(toRef(input.options)))}`);
          },
        }),
      },
    }),
  );
}
