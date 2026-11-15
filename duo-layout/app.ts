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
// the sidebar toggle and Back first and New thread alone at the bottom;
// app.css moves the thread's own header actions in between. With the strip on the left
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
const EDGE_PX = 24; // touches starting this close to the left edge stay with iOS
const BOTTOM_EDGE_PX = 40; // and this close to the bottom (home indicator)
const IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"], [role="menu"], [data-vaul-drawer], [data-vaul-no-drag], pre, table, [data-duo-dock], [data-duo-sheet]';

type Insets = { top: number; right: number; bottom: number; left: number };
type Native = {
  safeArea?: unknown;
  capabilities?: unknown;
  post?: (message: unknown) => void;
  subscribe?: (listener: (event: unknown) => void) => () => void;
};
type Swipe = { id: number; x0: number; y0: number; horizontal: boolean | null; inSidebar: boolean };

// Lucide glyphs (ISC), drawn at 22pt in the dock.
const ICONS = {
  threads: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  archive:
    '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  todo: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
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

/** bb's own element, never the dock's proxy that carries the same label. */
const find = (selector: string) =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((el) => !el.closest("[data-duo-dock]")) ?? null;
const PANEL = '[data-panel-id="thread-detail-secondary-panel"]';
const HEADER = '[data-testid="app-page-header-content-row"]';
const THREAD_MENU = `${HEADER} button[aria-label="Thread actions"]`;
const ARCHIVE = 'button[aria-label="Archive thread"]';
const railButton = (label: string) => find(`[data-testid="app-nav-rail"] button[aria-label="${label}"]`);

/** bb's menus (Radix) open on a primary pointerdown, not on click. */
function openMenu(trigger: HTMLElement | null) {
  trigger?.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true }),
  );
}

function togglePanel() {
  (panelOpen() ? panelToggle("Hide") : panelToggle("Show"))?.click();
}

/**
 * A dock button that stands in for one of bb's own. bb's controls can't be
 * moved into the strip: WebKit on the phone clips them with the thread's
 * pane. So the dock draws its own and taps bb's.
 */
type DockItem = {
  label: string;
  icon: string;
  run: () => void;
  present?: () => boolean;
  pressed?: () => boolean;
};

function dockButton(item: DockItem) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", item.label);
  button.title = item.label;
  button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.icon}</svg>`;
  button.addEventListener("click", () => {
    haptic();
    item.run();
  });
  const refresh = () => {
    button.hidden = item.present ? !item.present() : false;
    if (item.pressed) button.setAttribute("aria-pressed", String(item.pressed()));
  };
  return { button, refresh };
}

/** Destinations without a tab of their own: bb's rail items and Settings. */
function moreTargets() {
  const rail = [...document.querySelectorAll<HTMLElement>('[data-testid="app-nav-rail"] button[aria-label]')].filter(
    (b) => !["Home", "Todo", "More"].includes(b.getAttribute("aria-label") ?? ""),
  );
  const settings = find('button[aria-label^="Settings"]');
  return settings ? [...rail, settings] : rail;
}

function mount({ signal }: { signal: AbortSignal }) {
  const root = document.documentElement;
  const query = window.matchMedia(WIDE_TOUCH);

  const dock = document.createElement("div");
  dock.dataset.duoDock = "";
  dock.setAttribute("role", "toolbar");
  dock.setAttribute("aria-label", "Duo");
  dock.setAttribute("aria-orientation", "vertical");

  // "More": a small sheet beside the strip with the remaining destinations.
  const sheet = document.createElement("div");
  sheet.dataset.duoSheet = "";
  sheet.setAttribute("role", "menu");
  sheet.hidden = true;
  const closeSheet = () => (sheet.hidden = true);
  const openSheet = (anchor: HTMLElement) => {
    sheet.replaceChildren(
      ...moreTargets().map((target) => {
        const row = document.createElement("button");
        row.type = "button";
        row.setAttribute("role", "menuitem");
        const icon = target.querySelector("svg")?.cloneNode(true);
        if (icon) row.append(icon);
        const label = document.createElement("span");
        label.textContent = (target.getAttribute("aria-label") ?? "").replace(/\s*\(.*\)$/, "");
        row.append(label);
        row.addEventListener("click", () => {
          haptic();
          closeSheet();
          target.click();
        });
        return row;
      }),
    );
    const r = anchor.getBoundingClientRect();
    sheet.style.setProperty("--duo-sheet-bottom", `${Math.round(window.innerHeight - r.bottom)}px`);
    sheet.hidden = false;
  };

  const items: { button: HTMLButtonElement; refresh: () => void }[] = [];
  const group = (name: string, ...list: DockItem[]) => {
    const div = document.createElement("div");
    div.dataset.duoDockGroup = name;
    for (const item of list) {
      const made = dockButton(item);
      items.push(made);
      div.append(made.button);
    }
    return div;
  };
  const route = (label: string) => () => railButton(label)?.getAttribute("aria-current") === "page";
  const moreItem: DockItem = {
    label: "More",
    icon: ICONS.grid,
    run: () => {
      const anchor = dock.querySelector<HTMLElement>('[aria-label="More"]');
      if (!sheet.hidden || !anchor) closeSheet();
      else openSheet(anchor);
    },
    present: () => moreTargets().length > 0,
  };
  dock.append(
    group(
      "thread",
      { label: "Right panel", icon: ICONS.panel, run: togglePanel, present: () => !!(find(PANEL) || find(THREAD_MENU)), pressed: panelOpen },
      { label: "Archive thread", icon: ICONS.archive, run: () => find(ARCHIVE)?.click(), present: () => !!find(ARCHIVE) },
      { label: "Thread actions", icon: ICONS.more, run: () => openMenu(find(THREAD_MENU)), present: () => !!find(THREAD_MENU) },
    ),
    group(
      "tabs",
      // bb's Home is the threads area itself, so one tab covers both: from Todo or
      // a More destination it goes home, and at home it shows or hides the list.
      {
        label: "Threads",
        icon: ICONS.threads,
        run: () => {
          const home = railButton("Home");
          if (home && home.getAttribute("aria-current") !== "page") home.click();
          else toggleSidebar();
        },
        pressed: () => (railButton("Home") ? route("Home")() && sidebarOpen() : sidebarOpen()),
      },
      { label: "Todo", icon: ICONS.todo, run: () => railButton("Todo")?.click(), present: () => !!railButton("Todo"), pressed: route("Todo") },
      moreItem,
    ),
    group("compose", { label: "New thread", icon: ICONS.compose, run: newThread }),
  );
  document.body.append(dock, sheet);
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (sheet.hidden) return;
      const t = e.target as Element | null;
      if (t && (sheet.contains(t) || t.closest('[data-duo-dock] [aria-label="More"]'))) return;
      closeSheet();
    },
    { capture: true, signal },
  );

  // bb's ⋯ menu anchors to its own button, which the phone doesn't paint in
  // the strip. Keep it, invisible, under the dock's ⋯ so the menu opens there.
  const pinThreadMenu = () => {
    const theirs = find(THREAD_MENU)?.parentElement;
    const ours = dock.querySelector<HTMLElement>('[aria-label="Thread actions"]');
    if (!theirs) return;
    if (!root.hasAttribute(STRIP) || !ours || ours.hidden) {
      theirs.removeAttribute("data-duo-pinned");
      for (const p of ["top", "left", "width", "height"]) theirs.style.removeProperty(p);
      return;
    }
    const r = ours.getBoundingClientRect();
    theirs.setAttribute("data-duo-pinned", "");
    theirs.style.setProperty("top", `${r.top}px`, "important");
    theirs.style.setProperty("left", `${r.left}px`, "important");
    theirs.style.setProperty("width", `${r.width}px`, "important");
    theirs.style.setProperty("height", `${r.height}px`, "important");
  };

  // The right panel is an inspector column: opening it hides the sidebar,
  // closing it brings the sidebar back if it was open, as on iPad.
  let panelWasOpen = panelOpen();
  let restoreSidebar = false;
  const followPanel = () => {
    const open = panelOpen();
    if (open === panelWasOpen) return;
    panelWasOpen = open;
    if (!root.hasAttribute(MARK)) return;
    if (open && sidebarOpen()) {
      restoreSidebar = true;
      toggleSidebar();
    } else if (!open) {
      if (restoreSidebar && !sidebarOpen()) toggleSidebar();
      restoreSidebar = false;
    }
  };

  let frame = 0;
  const refresh = () => {
    frame = 0;
    for (const item of items) item.refresh();
    for (const g of dock.querySelectorAll<HTMLElement>("[data-duo-dock-group]")) {
      g.hidden = ![...g.querySelectorAll("button")].some((b) => !b.hidden);
    }
    followPanel();
    pinThreadMenu();
  };
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(refresh);
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "data-panel-size", "aria-current", "aria-label"] });
  signal.addEventListener("abort", () => observer.disconnect());

  const sync = () => {
    const wide = query.matches;
    root.toggleAttribute(MARK, wide);
    const { right, bottom, left } = wide ? insets() : { right: 0, bottom: 0, left: 0 };
    const onLeft = right < STRIP_MIN_PX && left >= STRIP_MIN_PX;
    root.toggleAttribute(STRIP, right >= STRIP_MIN_PX || onLeft);
    root.toggleAttribute(STRIP_LEFT, onLeft);
    root.style.setProperty("--duo-strip", `${onLeft ? left : right}px`);
    root.style.setProperty("--duo-inset-bottom", `${bottom}px`);
    refresh();
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
    // Screen edges belong to iOS: back from the left edge, home at the bottom.
    if (t.clientX < EDGE_PX || t.clientY > window.innerHeight - BOTTOM_EDGE_PX) return;
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

  /**
   * Left over the thread opens the right panel; right closes it, or brings
   * the sidebar back. Left over the sidebar hides it.
   */
  const step = (dx: number, inSidebar: boolean) => {
    if (inSidebar) {
      if (dx > -TOGGLE_PX || !sidebarOpen()) return false;
      toggleSidebar();
      return true;
    }
    if (dx <= -TOGGLE_PX) {
      if (panelOpen() || !panelToggle("Show")) return false;
      panelToggle("Show")!.click();
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
    if (frame) cancelAnimationFrame(frame);
    unsubscribe?.();
    root.removeAttribute(STRIP);
    pinThreadMenu();
    dock.remove();
    sheet.remove();
    root.removeAttribute(MARK);
    root.removeAttribute(STRIP);
    root.removeAttribute(STRIP_LEFT);
    for (const name of ["--duo-strip", "--duo-inset-bottom"]) root.style.removeProperty(name);
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "duo-layout", mount });
});
