// bb-plugin-image-zoom: zoom and pan inside bb's image lightbox. The lightbox
// is a portaled `div[role=dialog].cursor-zoom-out` whose direct child `img` is
// the picture; clicking the img closes it. We intercept pointer, wheel and
// click events on that img in the window capture phase, before React sees
// them, and apply a translate+scale transform. Navigating to another image
// changes the same img's src, which resets the zoom.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const IMG = 'div[role="dialog"].cursor-zoom-out > img';
const ATTR = "data-image-zoom";
const CSS = `
div[role="dialog"].cursor-zoom-out:has(> img[${ATTR}]) { overflow: hidden; }
${IMG} { cursor: zoom-in; touch-action: none; user-select: none; -webkit-user-drag: none; }
${IMG}[${ATTR}="zoomed"] { cursor: grab; }
${IMG}[${ATTR}="zoomed"]:active { cursor: grabbing; }
`;
const CLICK_ZOOM = 2.5;
const DRAG_SLOP = 4;

type View = { s: number; x: number; y: number };

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "image-zoom",
    mount({ signal }) {
      const views = new WeakMap<HTMLImageElement, View>();
      const pointers = new Map<number, { x: number; y: number }>();
      let img: HTMLImageElement | null = null;
      let moved = 0;
      let pinch: { d: number; s: number } | null = null;

      const lightboxImg = (t: EventTarget | null) =>
        t instanceof HTMLImageElement && t.matches(IMG) ? t : null;

      const view = (el: HTMLImageElement) => views.get(el) ?? { s: 1, x: 0, y: 0 };

      function apply(el: HTMLImageElement, v: View) {
        if (v.s <= 1.001) v = { s: 1, x: 0, y: 0 };
        views.set(el, v);
        el.style.transformOrigin = "0 0";
        el.style.transform = v.s === 1 ? "" : `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
        el.setAttribute(ATTR, v.s === 1 ? "" : "zoomed");
      }

      // Scale so that the image point under (px, py) stays under it.
      function zoomAt(el: HTMLImageElement, s: number, px: number, py: number) {
        const v = view(el);
        const fit = el.naturalWidth / Math.max(1, el.getBoundingClientRect().width / v.s);
        const next = Math.min(Math.max(1, s), Math.max(8, fit * 4));
        const r = el.getBoundingClientRect();
        const ux = (px - r.left) / v.s;
        const uy = (py - r.top) / v.s;
        apply(el, { s: next, x: v.x + px - ux * next - r.left, y: v.y + py - uy * next - r.top });
      }

      function panBy(el: HTMLImageElement, dx: number, dy: number) {
        const v = view(el);
        if (v.s > 1) apply(el, { ...v, x: v.x + dx, y: v.y + dy });
      }

      const opts = { capture: true, signal } as const;

      window.addEventListener(
        "wheel",
        (e) => {
          const el = document.querySelector<HTMLImageElement>(IMG);
          if (!el || !(e.target instanceof Node) || !el.parentElement?.contains(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          const v = view(el);
          // Trackpad pinch arrives as ctrl+wheel. A plain two-finger scroll pans
          // once zoomed; before that, any wheel zooms.
          if (!e.ctrlKey && v.s > 1 && e.deltaMode === 0 && Math.abs(e.deltaX) + Math.abs(e.deltaY) < 60) {
            panBy(el, -e.deltaX, -e.deltaY);
            return;
          }
          const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
          zoomAt(el, v.s * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
        },
        { ...opts, passive: false },
      );

      window.addEventListener(
        "pointerdown",
        (e) => {
          const el = lightboxImg(e.target);
          if (!el) return;
          e.preventDefault();
          e.stopPropagation();
          el.setPointerCapture(e.pointerId);
          img = el;
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 1) moved = 0;
          if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view(el).s };
            moved = DRAG_SLOP + 1;
          }
        },
        opts,
      );

      window.addEventListener(
        "pointermove",
        (e) => {
          const prev = pointers.get(e.pointerId);
          if (!img || !prev) return;
          e.preventDefault();
          const cur = { x: e.clientX, y: e.clientY };
          pointers.set(e.pointerId, cur);
          if (pinch && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            zoomAt(img, (pinch.s * d) / Math.max(1, pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
            return;
          }
          moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
          if (moved > DRAG_SLOP) panBy(img, cur.x - prev.x, cur.y - prev.y);
        },
        opts,
      );

      const release = (e: PointerEvent) => {
        if (!pointers.delete(e.pointerId)) return;
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) img = null;
      };
      window.addEventListener("pointerup", release, opts);
      window.addEventListener("pointercancel", release, opts);

      // The lightbox closes on a click on the image; turn that click into
      // zoom in / zoom out instead, and swallow the click that ends a drag.
      window.addEventListener(
        "click",
        (e) => {
          const el = lightboxImg(e.target);
          if (!el) return;
          e.preventDefault();
          e.stopPropagation();
          if (moved > DRAG_SLOP) return;
          if (view(el).s > 1) apply(el, { s: 1, x: 0, y: 0 });
          else zoomAt(el, CLICK_ZOOM, e.clientX, e.clientY);
        },
        opts,
      );

      window.addEventListener(
        "keydown",
        (e) => {
          const el = document.querySelector<HTMLImageElement>(IMG);
          if (!el || e.altKey || e.ctrlKey || e.metaKey) return;
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const s = view(el).s;
          if (e.key === "+" || e.key === "=") zoomAt(el, s * 1.5, cx, cy);
          else if (e.key === "-" || e.key === "_") zoomAt(el, s / 1.5, cx, cy);
          else if (e.key === "0") apply(el, { s: 1, x: 0, y: 0 });
          else return;
          e.preventDefault();
          e.stopPropagation();
        },
        opts,
      );

      // Arrow navigation reuses the img and swaps its src: start the new image unzoomed.
      const observer = new MutationObserver((records) => {
        for (const { target } of records) {
          if (target instanceof HTMLImageElement && target.matches(IMG)) apply(target, { s: 1, x: 0, y: 0 });
        }
      });
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["src"] });

      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.append(style);

      return () => {
        observer.disconnect();
        style.remove();
        for (const el of document.querySelectorAll<HTMLImageElement>(`img[${ATTR}]`)) {
          el.removeAttribute(ATTR);
          el.style.transform = "";
          el.style.transformOrigin = "";
        }
      };
    },
  });
});
