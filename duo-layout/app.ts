// bb-plugin-duo-layout: bb on a wide touch screen, such as an unfolded iPhone
// Duo in landscape (951 x 669 pt) or an iPad.
//
// bb and the phone plugins switch to the phone layout only below 48rem, so
// such a screen gets the desktop layout, built for a mouse. This plugin marks
// the page with `html[data-duo-layout]` while the screen is touch-first and at
// least 48rem wide; app.css does the rest of the work under that mark.
//
// In landscape iOS reserves a full-height strip for the status bar on one
// side (84pt on the unfolded Duo). bb's mobile app runs the web UI in a
// WebView that reports `env(safe-area-inset-*)` as 0 and passes the real
// insets through its native bridge (`window.bb.native.safeArea`), so the
// script reads both and keeps the larger. With the strip on the right it sets
// `html[data-duo-strip]` and adds a dock there: like Notes and Apple's
// vertical toolbars on the Duo, the controls sit in the strip under the clock,
// the sidebar toggle first and New thread alone at the bottom; app.css moves
// the thread's own header actions in between. With the strip on the left
// (the phone turned the other way) it also sets `html[data-duo-strip-left]`:
// the same toolbar moves to that strip and the sidebar starts after it.
//
// Gestures treat the screen as a row of three panes, sidebar | thread | right
// panel: a sideways swipe over the thread moves one pane along that row.
// Left hides the sidebar, then opens the right panel; right closes the right
// panel, then brings the sidebar back. A left swipe over the sidebar hides it.
// Each step taps bb's own button and plays the app's selection haptic.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./app.css";

const WIDE_TOUCH = "(min-width: 48rem) and (pointer: coarse)";
const MARK = "data-duo-layout";
const STRIP = "data-duo-strip";
const STRIP_LEFT = "data-duo-strip-left";
const STRIP_MIN_PX = 56; // narrower insets (a notch's sliver) stay empty
const DECIDE_PX = 10; // movement before choosing between swipe and scroll
const TOGGLE_PX = 72; // horizontal travel that moves one pane
const IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"], [role="menu"], [data-vaul-drawer], [data-vaul-no-drag], pre, table, [data-duo-dock]';

type Insets = { top: number; right: number; bottom: number; left: number };
type Native = {
  safeArea?: unknown;
  capabilities?: unknown;
  post?: (message: unknown) => void;
  subscribe?: (listener: (event: unknown) => void) => () => void;
};
type Swipe = { id: number; x0: number; y0: number; horizontal: boolean | null; inSidebar: boolean };

const ICONS = {
  // lucide panel-left
  sidebar:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  // lucide square-pen
  compose:
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
};

function native(): Native | null {
  const bb = (window as { bb?: { native?: Native } }).bb;
  return bb && typeof bb.native === "object" && bb.native ? bb.native : null;
}

function nativeInsets(): Insets | null {
  const area = native()?.safeArea as Partial<Insets> | undefined;
  if (!area || typeof area !== "object") return null;
  const n = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
  return { top: n(area.top), right: n(area.right), bottom: n(area.bottom), left: n(area.left) };
}

/** CSS safe-area insets in px, read through a probe element. */
function cssInsets(): Insets {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const insets = {
    top: parseFloat(s.paddingTop) || 0,
    right: parseFloat(s.paddingRight) || 0,
    bottom: parseFloat(s.paddingBottom) || 0,
    left: parseFloat(s.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

function insets(): Insets {
  const css = cssInsets();
  const app = nativeInsets();
  if (!app) return css;
  return {
    top: Math.max(css.top, app.top),
    right: Math.max(css.right, app.right),
    bottom: Math.max(css.bottom, app.bottom),
    left: Math.max(css.left, app.left),
  };
}

function haptic() {
  const bridge = native();
  const caps = bridge?.capabilities;
  if (Array.isArray(caps) && caps.includes("haptic")) bridge?.post?.({ type: "haptic", kind: "selection" });
}

/** A sideways-scrollable block (code, table, diff) keeps the swipe for itself. */
function insideScrollableX(target: Element, boundary: Element) {
  for (let el: Element | null = target; el && el !== boundary; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll|overlay/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

const sidebarOpen = () =>
  document.querySelector('[data-collapsible][data-side="left"]')?.getAttribute("data-state") === "expanded";
const toggleSidebar = () => document.querySelector<HTMLElement>('[data-sidebar="trigger"]')?.click();
// bb keeps a closed right panel mounted at size 0, Hide button included.
const panelOpen = () => {
  const panel = document.querySelector('[data-panel-id="thread-detail-secondary-panel"]');
  return !!panel && parseFloat(panel.getAttribute("data-panel-size") ?? "0") > 0;
};
const panelToggle = (label: "Hide" | "Show") =>
  document.querySelector<HTMLElement>(`button[aria-label^="${label} right panel"]`);

function newThread() {
  const button = document.querySelector<HTMLElement>('button[aria-label^="New thread ("]');
  if (button) return button.click();
  // bb's own shortcut, ⇧⌘O, when the sidebar's button isn't mounted.
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "O", code: "KeyO", metaKey: true, shiftKey: true, bubbles: true }),
  );
}

function dockButton(label: string, icon: string, slot: string, action: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.dataset.duoDockSlot = slot;
  button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  button.addEventListener("click", () => {
    haptic();
    action();
  });
  return button;
}

function mount({ signal }: { signal: AbortSignal }) {
  const root = document.documentElement;
  const query = window.matchMedia(WIDE_TOUCH);

  const dock = document.createElement("div");
  dock.dataset.duoDock = "";
  dock.setAttribute("role", "toolbar");
  dock.setAttribute("aria-label", "Duo");
  dock.setAttribute("aria-orientation", "vertical");
  dock.append(
    dockButton("Toggle sidebar", ICONS.sidebar, "top", toggleSidebar),
    dockButton("New thread", ICONS.compose, "bottom", newThread),
  );
  document.body.appendChild(dock);

  const sync = () => {
    const wide = query.matches;
    root.toggleAttribute(MARK, wide);
    const { right, bottom, left } = wide ? insets() : { right: 0, bottom: 0, left: 0 };
    const onLeft = right < STRIP_MIN_PX && left >= STRIP_MIN_PX;
    root.toggleAttribute(STRIP, right >= STRIP_MIN_PX || onLeft);
    root.toggleAttribute(STRIP_LEFT, onLeft);
    root.style.setProperty("--duo-strip", `${onLeft ? left : right}px`);
    root.style.setProperty("--duo-inset-bottom", `${bottom}px`);
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
  // The app pushes new insets on rotation and when the bars change.
  const unsubscribe = native()?.subscribe?.((event) => {
    if ((event as { type?: unknown })?.type === "safe-area") later();
  });

  let swipe: Swipe | null = null;

  const onStart = (e: TouchEvent) => {
    swipe = null;
    if (!query.matches || e.touches.length !== 1) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest(IGNORE)) return;
    const pane = target.closest('[data-sidebar="inset"], [data-sidebar="panel"]');
    if (!pane || insideScrollableX(target, pane)) return;
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    const t = e.touches[0];
    swipe = {
      id: t.identifier,
      x0: t.clientX,
      y0: t.clientY,
      horizontal: null,
      inSidebar: pane.matches('[data-sidebar="panel"]'),
    };
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

  /** One step along sidebar | thread | right panel; false when there is none. */
  const step = (dx: number, inSidebar: boolean) => {
    if (inSidebar) {
      if (dx > -TOGGLE_PX || !sidebarOpen()) return false;
      toggleSidebar();
      return true;
    }
    if (dx <= -TOGGLE_PX) {
      if (sidebarOpen()) toggleSidebar();
      else if (!panelOpen() && panelToggle("Show")) panelToggle("Show")!.click();
      else return false;
      return true;
    }
    if (dx >= TOGGLE_PX) {
      if (panelOpen() && panelToggle("Hide")) panelToggle("Hide")!.click();
      else if (!sidebarOpen()) toggleSidebar();
      else return false;
      return true;
    }
    return false;
  };

  const onEnd = (e: TouchEvent) => {
    const done = swipe;
    if (!done) return;
    const t = [...e.changedTouches].find((touch) => touch.identifier === done.id);
    if (!t) return;
    swipe = null;
    if (!done.horizontal || e.type === "touchcancel") return;
    // A sideways swipe is never a tap, whether or not it moved a pane.
    if (e.cancelable) e.preventDefault();
    if (step(t.clientX - done.x0, done.inSidebar)) haptic();
  };

  const capture = { capture: true, signal };
  window.addEventListener("touchstart", onStart, { ...capture, passive: true });
  window.addEventListener("touchmove", onMove, { ...capture, passive: false });
  window.addEventListener("touchend", onEnd, capture);
  window.addEventListener("touchcancel", onEnd, capture);

  return () => {
    window.clearTimeout(timer);
    unsubscribe?.();
    dock.remove();
    root.removeAttribute(MARK);
    root.removeAttribute(STRIP);
    root.removeAttribute(STRIP_LEFT);
    for (const name of ["--duo-strip", "--duo-inset-bottom"]) root.style.removeProperty(name);
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "duo-layout", mount });
});
