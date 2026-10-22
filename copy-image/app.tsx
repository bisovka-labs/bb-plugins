// bb-plugin-copy-image — adds "Copy Image" to the right-click menu on images
// in the bb desktop app.
//
// The desktop app's native context menu (built in Electron's main process) has
// no image items, and a plugin cannot extend it. So on a right-click over an
// <img> we suppress the native menu and show a small menu of our own. Browser
// tabs (remote access) already have a native "Copy Image", so the script only
// activates in the desktop app.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

declare global {
  interface Window {
    bbDesktop?: unknown;
  }
}

const MENU_ID = "bb-copy-image-menu";

/** PNG bytes of an image: the clipboard accepts only image/png. */
async function imagePng(img: HTMLImageElement): Promise<Blob> {
  const response = await fetch(img.currentSrc || img.src, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (blob.type === "image/png") return blob;
  // JPEG/WebP/GIF/SVG: re-encode through a canvas.
  const source: CanvasImageSource = await createImageBitmap(blob).catch(() => img);
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("PNG encode failed"))), "image/png"),
  );
}

function menuItem(label: string, onSelect: () => void): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = label;
  item.style.cssText =
    "display:block;width:100%;padding:4px 12px;border:0;border-radius:5px;background:none;" +
    "color:inherit;font:inherit;text-align:left;cursor:default;white-space:nowrap;";
  item.addEventListener("mouseenter", () => (item.style.background = "rgb(10 130 255)"));
  item.addEventListener("mouseleave", () => (item.style.background = "none"));
  item.addEventListener("click", onSelect);
  return item;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "copy-image-context-menu",
    mount({ signal }) {
      if (window.bbDesktop === undefined) return;

      let menu: HTMLDivElement | null = null;
      const close = () => {
        menu?.remove();
        menu = null;
      };

      const open = (img: HTMLImageElement, x: number, y: number) => {
        close();
        menu = document.createElement("div");
        menu.id = MENU_ID;
        menu.setAttribute("role", "menu");
        menu.style.cssText =
          "position:fixed;z-index:2147483647;min-width:180px;padding:5px;border-radius:8px;" +
          "background:rgb(40 40 40 / 0.96);color:#fff;font:13px -apple-system,system-ui,sans-serif;" +
          "box-shadow:0 0 0 0.5px rgb(255 255 255 / 0.18),0 8px 24px rgb(0 0 0 / 0.45);" +
          "backdrop-filter:blur(20px);";
        menu.append(
          menuItem("Copy Image", () => {
            close();
            // A promise-valued ClipboardItem keeps the user activation of this click.
            navigator.clipboard
              .write([new ClipboardItem({ "image/png": imagePng(img) })])
              .catch((error) => console.error("[copy-image] copy failed", error));
          }),
          menuItem("Copy Image Address", () => {
            close();
            void navigator.clipboard.writeText(img.currentSrc || img.src);
          }),
        );
        document.body.append(menu);
        const { width, height } = menu.getBoundingClientRect();
        menu.style.left = `${Math.min(x, window.innerWidth - width - 4)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - height - 4)}px`;
      };

      const onContextMenu = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement) || !target.complete || target.naturalWidth === 0) {
          close();
          return;
        }
        // preventDefault also stops Electron's native "context-menu" menu.
        event.preventDefault();
        open(target, event.clientX, event.clientY);
      };
      const onPointerDown = (event: PointerEvent) => {
        if (menu && !menu.contains(event.target as Node)) close();
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") close();
      };

      const options = { capture: true, signal };
      document.addEventListener("contextmenu", onContextMenu, options);
      document.addEventListener("pointerdown", onPointerDown, options);
      document.addEventListener("keydown", onKeyDown, options);
      window.addEventListener("blur", close, { signal });
      window.addEventListener("resize", close, { signal });
      document.addEventListener("scroll", close, options);
      return close;
    },
  });
});
