// A swipe across a thread's row in the phone's sidebar: right dismisses waiting, left
// archives. The row follows the finger over a track that shows the action,
// and the track fills once a release would commit it.

const ROW = "[data-sidebar-rename-row]";
const THREAD_ID = "[data-sidebar-thread-id]";
// BB's own sidebar swipe and Mobile Layout's skip what sits inside these.
const NO_SIDEBAR_SWIPE = "data-no-sidebar-swipe";
const SKIP = 'input, textarea, [contenteditable="true"], button, [role="menu"]';

/** Movement before the gesture picks an axis. */
const LOCK = 10;
/** How far a row travels before a release commits, at most. */
const COMMIT = 88;
/** A flick this fast commits from a shorter travel, in px per ms. */
const FLICK = 0.5;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const SETTLE_MS = 280;
const LEAVE_MS = 220;
const COLLAPSE_MS = 200;

export type SwipeAction = "dismissWaiting" | "archive";

export interface SwipeOptions {
  /** A finger came down on a thread's row; the actions for it may be needed. */
  onStart(threadId: string): void;
  available(action: SwipeAction, threadId: string): boolean;
  /** The icon to show for an action, cloned into the track. */
  icon(action: SwipeAction): Element | null;
  /** Runs the action. Resolves once BB is done, whatever the outcome. */
  run(action: SwipeAction, threadId: string): Promise<void>;
  /** A light tap as the track fills or empties. */
  tap(): void;
}

interface Gesture {
  row: HTMLElement;
  threadId: string;
  x: number;
  y: number;
  locked: boolean;
  offset: number;
  track: HTMLElement | null;
  side: SwipeAction | null;
  armed: boolean;
  /** Recent positions, for the release's speed. */
  samples: { x: number; t: number }[];
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Starts listening on the document's window until the returned function runs. */
export function startRowSwipe(doc: Document, options: SwipeOptions): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  const html = doc.documentElement;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  let gesture: Gesture | null = null;
  let busy = false;

  const commitAt = (row: HTMLElement) =>
    Math.min(COMMIT, row.getBoundingClientRect().width * 0.3);

  const buildTrack = (row: HTMLElement) => {
    const parent = row.parentElement;
    if (!parent) return null;
    const track = doc.createElement("div");
    track.className = "row-swipe-track";
    track.setAttribute("aria-hidden", "true");
    Object.assign(track.style, {
      top: `${row.offsetTop}px`,
      left: `${row.offsetLeft}px`,
      width: `${row.offsetWidth}px`,
      height: `${row.offsetHeight}px`,
    });
    for (const action of ["dismissWaiting", "archive"] as const) {
      const slot = doc.createElement("span");
      slot.className = "row-swipe-icon";
      slot.dataset.action = action;
      const icon = options.icon(action);
      if (icon) slot.append(icon.cloneNode(true));
      track.append(slot);
    }
    parent.append(track);
    return track;
  };

  const place = (g: Gesture) => {
    g.row.style.translate = `${g.offset}px`;
    if (!g.track) return;
    const side = g.offset > 0 ? "dismissWaiting" : g.offset < 0 ? "archive" : null;
    const progress = Math.min(1, Math.abs(g.offset) / commitAt(g.row));
    const armed = progress >= 1;
    g.track.style.setProperty("--row-swipe-progress", String(progress));
    if (side !== g.side) {
      g.side = side;
      if (side) g.track.dataset.side = side;
      else delete g.track.dataset.side;
    }
    if (armed !== g.armed) {
      g.armed = armed;
      g.track.toggleAttribute("data-armed", armed);
      options.tap();
    }
  };

  const restore = (row: HTMLElement, track: HTMLElement | null) => {
    row.removeAttribute(NO_SIDEBAR_SWIPE);
    row.classList.remove("row-swipe-row");
    for (const key of ["translate", "transition", "height", "overflow", "opacity"])
      row.style.removeProperty(key);
    track?.remove();
  };

  const animate = (el: HTMLElement, ms: number, styles: Record<string, string>) => {
    el.style.transition = Object.keys(styles)
      .map((key) => `${key} ${ms}ms ${EASE}`)
      .join(", ");
    Object.assign(el.style, styles);
    return wait(ms);
  };

  /** Swallows the click a lifted finger sends, so the row does not open. */
  const swallowClick = () => {
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    win.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => win.removeEventListener("click", swallow, true), 400);
  };

  const finish = async (g: Gesture, commit: SwipeAction | null) => {
    const { row, track, threadId } = g;
    const fast = reduced.matches;
    busy = true;
    try {
      if (commit === "archive") {
        const height = row.offsetHeight;
        if (!fast) {
          await animate(row, LEAVE_MS, { translate: `${-row.offsetWidth}px` });
          row.style.height = `${height}px`;
          row.style.overflow = "hidden";
          track?.style.setProperty("transition", `height ${COLLAPSE_MS}ms ${EASE}, opacity ${COLLAPSE_MS}ms ${EASE}`);
          track?.style.setProperty("height", "0px");
          track?.style.setProperty("opacity", "0");
          await animate(row, COLLAPSE_MS, { height: "0px", opacity: "0" });
        }
        await options.run("archive", threadId).catch(() => {});
        // A thread with children asks first; on Cancel, or a failure, the row
        // is still listed and comes back.
        if (row.isConnected) {
          track?.remove();
          if (!fast) await animate(row, SETTLE_MS, { height: `${height}px`, opacity: "1", translate: "0px" });
          restore(row, null);
        } else {
          track?.remove();
        }
        return;
      }
      const ran = commit ? options.run(commit, threadId).catch(() => {}) : null;
      if (!fast) await animate(row, SETTLE_MS, { translate: "0px" });
      restore(row, track);
      await ran;
    } finally {
      busy = false;
    }
  };

  // BB's sidebar swipe starts on pointerdown, which comes before touchstart,
  // and checks this attribute then.
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || busy || !html.hasAttribute("data-phone-layout")) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(SKIP)) return;
    target.closest(ROW)?.setAttribute(NO_SIDEBAR_SWIPE, "");
  };

  const onStart = (event: TouchEvent) => {
    gesture = null;
    if (busy || !html.hasAttribute("data-phone-layout") || event.touches.length !== 1) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(SKIP)) return;
    const row = target.closest<HTMLElement>(ROW);
    const threadId = row?.querySelector<HTMLElement>(THREAD_ID)?.dataset.sidebarThreadId;
    if (!row || !threadId) return;
    row.setAttribute(NO_SIDEBAR_SWIPE, "");
    const touch = event.touches[0];
    gesture = {
      row,
      threadId,
      x: touch.clientX,
      y: touch.clientY,
      locked: false,
      offset: 0,
      track: null,
      side: null,
      armed: false,
      samples: [],
    };
    options.onStart(threadId);
  };

  const onMove = (event: TouchEvent) => {
    const g = gesture;
    if (!g) return;
    const touch = event.touches[0];
    const dx = touch.clientX - g.x;
    const dy = touch.clientY - g.y;
    if (!options.available(dx > 0 ? "dismissWaiting" : "archive", g.threadId)) {
      g.offset = 0;
      place(g);
      return;
    }
    if (!g.locked) {
      if (Math.abs(dy) > LOCK && Math.abs(dy) >= Math.abs(dx)) {
        g.row.removeAttribute(NO_SIDEBAR_SWIPE);
        gesture = null;
        return;
      }
      if (Math.abs(dx) < LOCK) return;
      g.locked = true;
      g.track = buildTrack(g.row);
      g.row.classList.add("row-swipe-row");
      g.row.style.transition = "none";
    }
    if (event.cancelable) event.preventDefault();
    // The slop the lock took is not travel; past the commit point the row
    // drags with resistance, so a long pull still reads as a pull.
    const raw = dx - Math.sign(dx) * LOCK;
    const limit = commitAt(g.row) * 1.4;
    const over = Math.abs(raw) - limit;
    g.offset = over > 0 ? Math.sign(raw) * (limit + over * 0.3) : raw;
    const now = event.timeStamp;
    g.samples.push({ x: touch.clientX, t: now });
    while (g.samples.length > 2 && now - g.samples[0].t > 80) g.samples.shift();
    place(g);
  };

  const onEnd = () => {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (!g.locked) {
      g.row.removeAttribute(NO_SIDEBAR_SWIPE);
      return;
    }
    swallowClick();
    const first = g.samples[0];
    const last = g.samples[g.samples.length - 1];
    const speed = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const flicked =
      Math.abs(speed) > FLICK &&
      Math.sign(speed) === Math.sign(g.offset) &&
      Math.abs(g.offset) > commitAt(g.row) / 2;
    const commit = g.armed || flicked ? g.side : null;
    if (commit && !g.armed && g.track) {
      g.track.toggleAttribute("data-armed", true);
      options.tap();
    }
    void finish(g, commit);
  };

  const onCancel = () => {
    const g = gesture;
    gesture = null;
    if (g) void finish(g, null);
  };

  const capture = { capture: true };
  win.addEventListener("pointerdown", onPointerDown, capture);
  win.addEventListener("touchstart", onStart, { capture: true, passive: true });
  win.addEventListener("touchmove", onMove, { capture: true, passive: false });
  win.addEventListener("touchend", onEnd, capture);
  win.addEventListener("touchcancel", onCancel, capture);
  return () => {
    win.removeEventListener("pointerdown", onPointerDown, capture);
    win.removeEventListener("touchstart", onStart, capture);
    win.removeEventListener("touchmove", onMove, capture);
    win.removeEventListener("touchend", onEnd, capture);
    win.removeEventListener("touchcancel", onCancel, capture);
    if (gesture) restore(gesture.row, gesture.track);
    gesture = null;
  };
}
