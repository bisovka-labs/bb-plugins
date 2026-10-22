import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useComposer, useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

// Buttons beside the composer's microphone that run Recap and Follow-ups on
// demand, since both have their automatic runs turned off.

const TAP_SLOP_PX = 10;

/**
 * Press handling for a composer action, after Advisor's switch. On a phone the
 * host unmounts composer actions as soon as the editor loses focus, so a press
 * never takes focus and a touch acts on pointerup, dropping the click after it.
 */
function usePress(onPress: () => void) {
  const tap = useRef<{ id: number; x: number; y: number } | null>(null);
  const handled = useRef(false);
  const far = (start: { x: number; y: number }, event: PointerEvent) =>
    Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX;
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      tap.current = null;
      handled.current = false;
      if (event.pointerType !== "touch" || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      tap.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (tap.current?.id === event.pointerId && far(tap.current, event)) tap.current = null;
    },
    onPointerCancel: () => {
      tap.current = null;
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const start = tap.current;
      tap.current = null;
      if (start?.id !== event.pointerId || far(start, event)) return;
      handled.current = true;
      onPress();
    },
    onMouseDown: (event: MouseEvent) => event.preventDefault(),
    onClick: (event: MouseEvent) => {
      const wasTap = handled.current;
      handled.current = false;
      if (wasTap && event.detail > 0) return;
      onPress();
    },
  };
}

function useThreadId(): string | null {
  const { scope } = useComposer();
  return scope.kind === "thread" ? scope.threadId : null;
}

/** Recap's own four-point star, drawn in BB's line. */
function RecapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden className="composer-action-icon">
      <path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z" transform="translate(0 1)" />
    </svg>
  );
}

/** Follow-ups' own icon, a speech bubble with a reply arrow. */
function FollowupsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="composer-action-icon">
      <path d="M7.5 10H13c.93 0 1.4 0 1.77.15.49.2.88.6 1.08 1.08.15.37.15.84.15 1.77" />
      <path d="M2 10.5c0-.77.01-1.52.04-2.25.08-2.37.12-3.56 1.09-4.53.96-.98 2.18-1.03 4.62-1.13C9.09 2.53 10.52 2.5 12 2.5s2.9.03 4.24.09c2.44.1 3.66.15 4.63 1.13.96.97 1 2.16 1.09 4.53.02.73.04 1.48.04 2.25s-.02 1.52-.04 2.25c-.09 2.37-.13 3.56-1.1 4.53-.96.98-2.18 1.03-4.62 1.13-.73.03-1.5.06-2.27.07-.74.01-1.11.02-1.44.15-.32.12-.6.36-1.15.83L9.2 21.32a.73.73 0 0 1-1.2-.55v-2.35l-.25-.01c-2.44-.1-3.66-.16-4.62-1.13-.97-.98-1.01-2.16-1.1-4.53A64 64 0 0 1 2 10.5Z" />
      <path d="M10 7s-3 2.2-3 3 3 3 3 3" />
    </svg>
  );
}

const recapState = z.object({ generating: z.boolean() }).passthrough();

/** Writes the thread's recap now; the card above the composer shows it. */
export function RecapAction() {
  const sdk = useSdk();
  const threadId = useThreadId();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    if (!threadId || busy) return;
    setBusy(true);
    try {
      await sdk.plugins.callRpc({
        pluginId: "bb-recap",
        method: "recap_generate",
        input: { threadId },
        outputSchema: recapState,
      });
    } catch {
      // Recap shows its own errors on its card.
    } finally {
      setBusy(false);
    }
  }, [sdk, threadId, busy]);
  const press = usePress(() => void run());
  if (!threadId) return null;
  return (
    <button
      type="button"
      className="composer-action"
      aria-label="Write a recap of this thread"
      title="Write a recap of this thread"
      aria-busy={busy}
      {...press}
    >
      <RecapIcon />
    </button>
  );
}

const followupsState = z.object({ enabled: z.boolean() }).passthrough();

// The last state this page saw per thread: the host unmounts composer actions
// whenever the phone's composer collapses, and the button should come back as
// it was rather than blank for a round trip.
const known = new Map<string, boolean>();

/**
 * Turns Follow-ups on or off for this thread. Follow-ups has no one-off run:
 * on drafts suggestions now and after each later turn of this thread only;
 * off stops and clears them. Every other thread stays off.
 */
export function FollowupsAction() {
  const sdk = useSdk();
  const threadId = useThreadId();
  const [enabled, setEnabled] = useState<boolean | null>(threadId ? known.get(threadId) ?? null : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!threadId) return;
    let live = true;
    sdk.plugins
      .callRpc({ pluginId: "followups", method: "followups_get", input: { threadId }, outputSchema: followupsState })
      .then((state) => {
        known.set(threadId, state.enabled);
        if (live) setEnabled(state.enabled);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sdk, threadId]);

  const toggle = useCallback(async () => {
    if (!threadId || enabled === null || busy) return;
    const next = !enabled;
    setBusy(true);
    setEnabled(next);
    try {
      const state = await sdk.plugins.callRpc({
        pluginId: "followups",
        method: "followups_set_enabled",
        input: { threadId, enabled: next },
        outputSchema: followupsState,
      });
      known.set(threadId, state.enabled);
      setEnabled(state.enabled);
    } catch {
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  }, [sdk, threadId, enabled, busy]);
  const press = usePress(() => void toggle());

  if (!threadId || enabled === null) return null;
  const label = enabled ? "Follow-ups on for this thread" : "Suggest follow-ups for this thread";
  return (
    <button
      type="button"
      className="composer-action"
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      aria-busy={busy}
      {...press}
    >
      <FollowupsIcon />
    </button>
  );
}
