// bb-plugin-tap-to-dictate: on a phone, one tap on the microphone starts
// dictation or opens the photo picker, even while the keyboard is open.
//
// bb's mic button starts recording from its click handler. On iOS, with the
// keyboard up, the first tap's click never reaches it: the editor loses focus,
// the keyboard hides, the prompt box collapses and the mic moves away, so a
// second tap is needed. bb already works around the same problem for its send
// button by acting on the touch pointerup and swallowing the late native
// click; this script does the same for the mic, recording controls and photos.
//
// bb also hides the keyboard for the whole recording: it blurs the editor and
// makes it read-only until the transcript lands, and iOS drops the keyboard
// for a read-only field. This script parks focus in a hidden textarea inside
// the prompt box during the tap, so the keyboard stays up, then hands focus
// back to the editor once it is editable again. iOS allows that programmatic
// focus because the keyboard is already open.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const START = 'button[aria-label="Start voice input"]';
const LABELS = [
  "Start voice input",
  "Cancel recording",
  "Stop and add to draft",
  "Stop and add text",
  "Send voice input",
];
const VOICE_BUTTON = LABELS.map((l) => `button[aria-label="${l}"]:not(:disabled)`).join(", ");
const PHOTO_BUTTON = 'form[data-promptbox] button[aria-label="Attach photos"]:not(:disabled)';
const TAP_BUTTON = `${VOICE_BUTTON}, ${PHOTO_BUTTON}`;
const SLOP_PX = 10; // finger movement that turns a tap into a scroll
const LATE_CLICK_MS = 1000;
const NEVER_LOCKED_MS = 5000; // recording did not start, give focus back

type Tap = { pointerId: number; x: number; y: number; button: HTMLButtonElement };

function tapButtonFrom(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLButtonElement>(TAP_BUTTON) : null;
}

/** Clicks the button while making bb's `activeElement.blur()` a no-op. */
function clickKeepingFocus(button: HTMLButtonElement) {
  const active = document.activeElement;
  const editing = active instanceof HTMLElement && (active.isContentEditable || active instanceof HTMLTextAreaElement);
  if (!editing) return button.click();
  active.blur = () => {};
  try {
    button.click();
  } finally {
    delete (active as Partial<HTMLElement>).blur;
  }
}

/** Keeps the keyboard open while bb's editor is read-only for a recording. */
function holdKeyboard(editor: HTMLElement, signal: AbortSignal) {
  const parent = editor.parentElement;
  if (!parent) return;
  const r = editor.getBoundingClientRect();
  const proxy = document.createElement("textarea");
  proxy.setAttribute("aria-hidden", "true");
  proxy.tabIndex = -1;
  // 16px stops iOS from zooming in on focus; fixed at the editor so nothing scrolls.
  proxy.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:1px;height:1px;opacity:0;font-size:16px;caret-color:transparent;border:0;padding:0;pointer-events:none;`;
  parent.append(proxy);
  proxy.focus({ preventScroll: true });

  let locked = false;
  const release = (refocus: boolean) => {
    observer.disconnect();
    window.clearTimeout(timer);
    proxy.removeEventListener("blur", onProxyBlur);
    if (refocus && editor.isConnected) editor.focus({ preventScroll: true });
    proxy.remove();
  };
  const onProxyBlur = () => release(false); // the user moved on or closed the keyboard
  const observer = new MutationObserver(() => {
    if (editor.getAttribute("contenteditable") !== "true") locked = true;
    else if (locked) release(true);
  });
  observer.observe(editor, { attributes: true, attributeFilter: ["contenteditable"] });
  const timer = window.setTimeout(() => locked || release(true), NEVER_LOCKED_MS);
  proxy.addEventListener("blur", onProxyBlur);
  proxy.addEventListener("beforeinput", (e) => e.preventDefault()); // typing waits for the editor
  signal.addEventListener("abort", () => release(false), { once: true });
}

function inside(button: HTMLElement, x: number, y: number) {
  const r = button.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

function mount({ signal }: { signal: AbortSignal }) {
  let tap: Tap | null = null;
  let dropLateClick: (() => void) | null = null;

  /** Swallows the native click iOS may still deliver after the layout changed. */
  const swallowNextClick = () => {
    dropLateClick?.();
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pointerdown", stop, true);
      dropLateClick = null;
    };
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return; // our own synthetic click
      stop();
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const timer = window.setTimeout(stop, LATE_CLICK_MS);
    window.addEventListener("click", onClick, true);
    window.addEventListener("pointerdown", stop, true);
    dropLateClick = stop;
  };

  const onDown = (e: PointerEvent) => {
    tap = null;
    if (e.pointerType !== "touch" || !e.isPrimary || e.button !== 0) return;
    const button = tapButtonFrom(e.target);
    if (button) tap = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, button };
  };

  const onMove = (e: PointerEvent) => {
    if (tap?.pointerId === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > SLOP_PX) tap = null;
  };

  const onUp = (e: PointerEvent) => {
    const t = tap;
    tap = null;
    if (!t || t.pointerId !== e.pointerId) return;
    if (!t.button.isConnected || t.button.disabled || !inside(t.button, e.clientX, e.clientY)) return;
    swallowNextClick();
    const active = document.activeElement;
    if (t.button.matches(START) && active instanceof HTMLElement && active.isContentEditable) holdKeyboard(active, signal);
    // Keep user activation for microphone permission and the native photo picker.
    clickKeepingFocus(t.button);
  };

  // A tap on a button would otherwise move focus off the editor and hide the keyboard.
  const onMouseDown = (e: MouseEvent) => {
    if (tapButtonFrom(e.target) && matchMedia("(pointer: coarse)").matches) e.preventDefault();
  };

  const opts = { capture: true, signal };
  window.addEventListener("pointerdown", onDown, opts);
  window.addEventListener("pointermove", onMove, opts);
  window.addEventListener("pointerup", onUp, opts);
  window.addEventListener("pointercancel", () => (tap = null), opts);
  window.addEventListener("mousedown", onMouseDown, opts);

  return () => {
    tap = null;
    dropLateClick?.();
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "tap-to-dictate", mount });
});
