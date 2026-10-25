// bb-plugin-copy-code: tap or click inline code in rendered markdown (a URL,
// a command, a path in backticks) to copy its text. Code blocks (`pre > code`)
// keep bb's own copy button, and code inside links or editors is left alone.
// A selection drag still selects text: only a plain click copies.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const CODE = "code:not(pre code):not(a code):not([contenteditable] code)";
const COPIED = "data-copy-code";
const CSS = `
${CODE} { cursor: copy; -webkit-tap-highlight-color: transparent; transition: background-color 0.15s, color 0.15s; }
${CODE}:hover { box-shadow: inset 0 0 0 1px color-mix(in oklab, currentColor 25%, transparent); }
code[${COPIED}] { background-color: color-mix(in oklab, #22c55e 28%, transparent) !important; }
#copy-code-toast {
  position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); z-index: 2147483647;
  transform: translateX(-50%); padding: 6px 12px; border-radius: 999px; pointer-events: none;
  background: rgb(30 30 30 / 0.92); color: #fff; font: 13px -apple-system, system-ui, sans-serif;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.3); animation: copy-code-fade 1.4s ease forwards;
}
@keyframes copy-code-fade { 0%, 75% { opacity: 1; } 100% { opacity: 0; } }
`;

// navigator.clipboard needs a secure context; fall back to execCommand.
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy rejected");
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "copy-code",
    mount({ signal }) {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.append(style);

      const toast = (label: string) => {
        document.getElementById("copy-code-toast")?.remove();
        const el = document.createElement("div");
        el.id = "copy-code-toast";
        el.setAttribute("role", "status");
        el.textContent = label;
        document.body.append(el);
        setTimeout(() => el.remove(), 1400);
      };

      window.addEventListener(
        "click",
        (e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          const code = e.target instanceof Element ? e.target.closest<HTMLElement>(CODE) : null;
          if (!code) return;
          if (!window.getSelection()?.isCollapsed) return;
          const text = code.innerText.trim();
          if (!text) return;
          e.preventDefault();
          e.stopPropagation();
          copyText(text).then(
            () => {
              code.setAttribute(COPIED, "");
              setTimeout(() => code.removeAttribute(COPIED), 900);
              toast("Скопировано");
            },
            (error) => {
              console.error("[copy-code] copy failed", error);
              toast("Не удалось скопировать");
            },
          );
        },
        { capture: true, signal },
      );

      return () => {
        style.remove();
        document.getElementById("copy-code-toast")?.remove();
      };
    },
  });
});
