// bb-plugin-blur-titles: a sidebar-footer button that blurs thread titles so
// the interface can be screenshotted. bb's sidebar rows and thread header
// render `.bb-thread-title`; plugin thread lists (Recent Threads) render the
// SDK's ThreadTitle without it, inside the span next to the row's thread link.
// The state survives reloads.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const ATTR = "data-blur-titles";
const STORAGE_KEY = "bb-plugin-blur-titles";
const CSS = `
html[${ATTR}] .bb-thread-title,
html[${ATTR}] a[data-sidebar-thread-id] ~ span > span.truncate {
  filter: blur(5px);
  transition: filter 120ms ease;
}
`;

function setBlurred(on: boolean) {
  document.documentElement.toggleAttribute(ATTR, on);
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "blur-titles",
    mount() {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.append(style);
      document.documentElement.toggleAttribute(ATTR, localStorage.getItem(STORAGE_KEY) === "1");
      return () => {
        style.remove();
        document.documentElement.removeAttribute(ATTR);
      };
    },
  });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "toggle",
    label: "Размыть названия тредов",
    icon: "EyeOff",
    onActivate: () => setBlurred(!document.documentElement.hasAttribute(ATTR)),
  });
});
