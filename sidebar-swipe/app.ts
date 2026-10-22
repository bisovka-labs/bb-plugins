// bb-plugin-sidebar-swipe: on a phone, a rightward swipe that starts anywhere
// in the left half of a thread, including at the very screen edge, opens the
// thread list.
//
// bb ships its own swipe, but it ignores the first 24 px and lets the page
// scroll during swipes that start past 72 px. This script turns bb's swipe off
// for the thread view (`data-no-sidebar-swipe` on the inset) and replaces it.
// It locks scrolling once a gesture reads as horizontal, slides the thread
// with the finger the same way bb does, then opens the sidebar through bb's own
// toggle so app state stays in sync.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const COMPACT = "(max-width: 767.98px)"; // bb's mobile drawer layout (below Tailwind md)
const START_ZONE = 0.5; // fraction of screen width, from the left
const DECIDE_PX = 6; // movement before choosing between swipe and scroll
const OPEN_PROGRESS = 0.3;
const FLICK_SPEED = 350; // px/s
const SETTLE_MS = 220;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [data-vaul-drawer], [data-vaul-no-drag]';
const BUILTIN_OFF = "data-no-sidebar-swipe";

type Drag = {
  id: number;
  x0: number;
  y0: number;
  width: number;
  dragging: boolean;
  progress: number;
  lastX: number;
  lastT: number;
  velocity: number;
};

function parts() {
  return {
    panel: document.querySelector<HTMLElement>('[data-sidebar="panel"]'),
    inset: document.querySelector<HTMLElement>('[data-sidebar="inset"]'),
    backdrop: document.querySelector<HTMLElement>("[data-sidebar-mobile-backdrop]"),
  };
}

/** The mobile sidebar width bb uses: min(86vw, 360px). */
function sidebarWidth() {
  return Math.min(window.innerWidth * 0.86, 360);
}

/** A sideways-scrolled block (code, table, diff) keeps the swipe for itself. */
function insideScrolledBlock(target: Element, boundary: Element) {
  for (let el: Element | null = target; el && el !== boundary; el = el.parentElement) {
    if (el.scrollLeft > 0 && /auto|scroll|overlay/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

/** Same inline styles bb's own swipe writes while the thread follows the finger. */
function paint(progress: number, width: number, settling: boolean) {
  const { panel, inset, backdrop } = parts();
  const x = `${width * progress}px`;
  panel?.setAttribute("data-vaul-animate", "false");
  if (inset) {
    inset.style.translate = x;
    inset.style.transition = settling ? `translate ${SETTLE_MS}ms ${EASE}` : "none";
  }
  if (backdrop) {
    backdrop.style.translate = x;
    backdrop.style.opacity = String(progress);
    backdrop.style.transition = settling ? `opacity ${SETTLE_MS}ms ${EASE}, translate ${SETTLE_MS}ms ${EASE}` : "none";
  }
}

function unpaint() {
  const { panel, inset, backdrop } = parts();
  panel?.removeAttribute("data-vaul-animate");
  for (const el of [inset, backdrop]) {
    el?.style.removeProperty("translate");
    el?.style.removeProperty("transition");
  }
  backdrop?.style.removeProperty("opacity");
}

function mount({ signal }: { signal: AbortSignal }) {
  let drag: Drag | null = null;
  let settleTimer: number | undefined;

  const onStart = (e: TouchEvent) => {
    if (drag || e.touches.length !== 1 || !window.matchMedia(COMPACT).matches) {
      drag = null;
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    const inset = target?.closest('[data-sidebar="inset"]');
    if (!target || !inset) return;
    // Runs before bb's capture listener on document, so bb skips this touch.
    inset.setAttribute(BUILTIN_OFF, "");

    const touch = e.touches[0];
    if (parts().panel?.getAttribute("data-state") !== "closed") return;
    if (touch.clientX > window.innerWidth * START_ZONE) return;
    if (target.closest(IGNORE) || insideScrolledBlock(target, inset)) return;
    if (!(window.getSelection()?.isCollapsed ?? true)) return;

    window.clearTimeout(settleTimer);
    unpaint();
    drag = {
      id: touch.identifier,
      x0: touch.clientX,
      y0: touch.clientY,
      width: sidebarWidth(),
      dragging: false,
      progress: 0,
      lastX: touch.clientX,
      lastT: e.timeStamp,
      velocity: 0,
    };
  };

  const onMove = (e: TouchEvent) => {
    if (!drag) return;
    const touch = [...e.touches].find((t) => t.identifier === drag!.id);
    if (!touch) return;
    const dx = touch.clientX - drag.x0;
    const dy = touch.clientY - drag.y0;
    if (!drag.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return;
      // Anything up to 45° to the right counts as a swipe; the rest is scrolling.
      if (dx <= 0 || dx < Math.abs(dy)) {
        drag = null;
        return;
      }
      drag.dragging = true;
    }
    if (e.cancelable) e.preventDefault();
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) {
      drag.velocity = ((touch.clientX - drag.lastX) / dt) * 1000;
      drag.lastX = touch.clientX;
      drag.lastT = e.timeStamp;
    }
    drag.progress = Math.min(1, Math.max(0, dx / drag.width));
    paint(drag.progress, drag.width, false);
  };

  const onEnd = (e: TouchEvent) => {
    if (!drag || ![...e.changedTouches].some((t) => t.identifier === drag!.id)) return;
    const done = drag;
    drag = null;
    if (!done.dragging) return;
    // Swallow the click a finished swipe would otherwise produce.
    if (e.type === "touchend" && e.cancelable) e.preventDefault();

    const speed = e.timeStamp - done.lastT > 100 ? 0 : done.velocity;
    const open = done.progress >= OPEN_PROGRESS || (done.progress > 0.05 && speed > FLICK_SPEED);
    paint(open ? 1 : 0, done.width, true);
    if (open) document.querySelector<HTMLElement>('[data-sidebar="trigger"]')?.click();
    settleTimer = window.setTimeout(unpaint, SETTLE_MS + 30);
  };

  const capture = { capture: true, signal };
  window.addEventListener("touchstart", onStart, { ...capture, passive: true });
  window.addEventListener("touchmove", onMove, { ...capture, passive: false });
  window.addEventListener("touchend", onEnd, capture);
  window.addEventListener("touchcancel", onEnd, capture);

  return () => {
    window.clearTimeout(settleTimer);
    if (drag?.dragging) unpaint();
    for (const el of document.querySelectorAll(`[data-sidebar="inset"][${BUILTIN_OFF}]`)) el.removeAttribute(BUILTIN_OFF);
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "sidebar-swipe", mount });
});
