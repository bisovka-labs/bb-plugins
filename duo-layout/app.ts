// bb-plugin-duo-layout: bb on a wide touch screen, such as an unfolded iPhone
// Duo in landscape (about 950 x 670 pt) or an iPad.
//
// bb and the phone plugins switch to the phone layout only below 48rem, so
// such a screen gets the desktop layout, built for a mouse. This plugin marks
// the page with `html[data-duo-layout]` while the screen is touch-first and at
// least 48rem wide; app.css does the rest of the work under that mark. The
// script also adds one gesture: a sideways swipe over the thread hides the
// sidebar (left) or brings it back (right), through bb's own toggle.
//
// In landscape iOS reserves a full-height safe-area strip on the side of the
// status bar (84pt on the unfolded Duo). When that strip is on the right, the
// script marks it with `html[data-duo-strip]` and app.css moves the thread's
// header actions into it as a vertical glass toolbar.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./app.css";

const WIDE_TOUCH = "(min-width: 48rem) and (pointer: coarse)";
const MARK = "data-duo-layout";
const STRIP = "data-duo-strip";
const STRIP_MIN_PX = 56; // narrower insets (a notch's sliver) stay empty
const DECIDE_PX = 10; // movement before choosing between swipe and scroll
const TOGGLE_PX = 72; // horizontal travel that toggles the sidebar
const IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"], [role="menu"], [data-vaul-drawer], [data-vaul-no-drag], pre, table';

type Swipe = { id: number; x0: number; y0: number; horizontal: boolean | null };

/** A sideways-scrollable block (code, table, diff) keeps the swipe for itself. */
function insideScrollableX(target: Element, boundary: Element) {
  for (let el: Element | null = target; el && el !== boundary; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll|overlay/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

function sidebarState() {
  return document.querySelector('[data-collapsible][data-side="left"]')?.getAttribute("data-state");
}

/** The right safe-area inset in px, read through a probe element. */
function rightInset() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-right:env(safe-area-inset-right)";
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingRight) || 0;
  probe.remove();
  return px;
}

function mount({ signal }: { signal: AbortSignal }) {
  const root = document.documentElement;
  const query = window.matchMedia(WIDE_TOUCH);
  const sync = () => {
    root.toggleAttribute(MARK, query.matches);
    const strip = query.matches ? rightInset() : 0;
    root.toggleAttribute(STRIP, strip >= STRIP_MIN_PX);
    root.style.setProperty("--duo-strip", `${strip}px`);
  };
  sync();
  query.addEventListener("change", sync, { signal });
  // Rotating flips the strip between the sides; the inset settles after the turn.
  let timer: number | undefined;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sync, 300);
  };
  window.addEventListener("resize", later, { signal });
  window.addEventListener("orientationchange", later, { signal });

  let swipe: Swipe | null = null;

  const onStart = (e: TouchEvent) => {
    swipe = null;
    if (!query.matches || e.touches.length !== 1) return;
    const target = e.target instanceof Element ? e.target : null;
    const inset = target?.closest('[data-sidebar="inset"]');
    if (!target || !inset || target.closest(IGNORE) || insideScrollableX(target, inset)) return;
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    const t = e.touches[0];
    swipe = { id: t.identifier, x0: t.clientX, y0: t.clientY, horizontal: null };
  };

  const onMove = (e: TouchEvent) => {
    if (!swipe) return;
    const t = [...e.touches].find((touch) => touch.identifier === swipe!.id);
    if (!t) return;
    const dx = t.clientX - swipe.x0;
    const dy = t.clientY - swipe.y0;
    if (swipe.horizontal === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return;
      // Under 30° from horizontal counts as a swipe; the rest is scrolling.
      swipe.horizontal = Math.abs(dx) > Math.abs(dy) * 1.7;
      if (!swipe.horizontal) {
        swipe = null;
        return;
      }
    }
    // Keep the page from scrolling while a swipe is underway.
    if (e.cancelable) e.preventDefault();
  };

  const onEnd = (e: TouchEvent) => {
    const done = swipe;
    if (!done) return;
    const t = [...e.changedTouches].find((touch) => touch.identifier === done.id);
    if (!t) return;
    swipe = null;
    if (!done.horizontal || e.type === "touchcancel") return;
    const dx = t.clientX - done.x0;
    const state = sidebarState();
    const toggle = (dx >= TOGGLE_PX && state === "collapsed") || (dx <= -TOGGLE_PX && state === "expanded");
    if (!toggle) return;
    if (e.cancelable) e.preventDefault(); // no click after a swipe
    document.querySelector<HTMLElement>('[data-sidebar="trigger"]')?.click();
  };

  const capture = { capture: true, signal };
  window.addEventListener("touchstart", onStart, { ...capture, passive: true });
  window.addEventListener("touchmove", onMove, { ...capture, passive: false });
  window.addEventListener("touchend", onEnd, capture);
  window.addEventListener("touchcancel", onEnd, capture);

  return () => {
    window.clearTimeout(timer);
    root.removeAttribute(MARK);
    root.removeAttribute(STRIP);
    root.style.removeProperty("--duo-strip");
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "duo-layout", mount });
});
