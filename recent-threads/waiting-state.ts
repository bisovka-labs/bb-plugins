import { useMemo, useSyncExternalStore } from "react";

export const AWAITING_KEY = "recent-threads:awaiting-reply";
export const DISMISSED_KEY = "recent-threads:dismissed-waiting";
const CHANGED = "recent-threads:waiting-changed";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGED, listener);
  };
}

export function readTimes(key: string): Record<string, number> {
  return parseTimes(localStorage.getItem(key) ?? "{}");
}

function parseTimes(raw: string): Record<string, number> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, at]) => typeof at === "number" && Number.isFinite(at)),
    );
  } catch {
    return {};
  }
}

export function writeTimes(key: string, times: Readonly<Record<string, number>>) {
  localStorage.setItem(key, JSON.stringify(times));
  window.dispatchEvent(new Event(CHANGED));
}

export function useTimes(key: string): Readonly<Record<string, number>> {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(key) ?? "{}");
  return useMemo(() => parseTimes(raw), [raw]);
}
