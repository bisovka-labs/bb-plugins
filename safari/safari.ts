// Safari control through AppleScript (osascript) and screencapture.
//
// Everything runs on the machine where the BB server runs. Values reach
// AppleScript as `argv`, never spliced into the script text.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TabRef = { window?: number; tab?: number };

export type TabInfo = {
  window: number;
  tab: number;
  current: boolean;
  url: string;
  title: string;
};

export class SafariError extends Error {}

const JS_DISABLED_HINT =
  "Safari blocks JavaScript from automation. Turn it on once: Safari → Settings → Advanced → " +
  "«Show features for web developers», then Settings → Developer → «Allow JavaScript from Apple Events».";

function run(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) return resolve(stdout.replace(/\n$/, ""));
        const message = (stderr || error.message).trim();
        reject(new SafariError(explain(message)));
      },
    );
  });
}

function explain(message: string): string {
  if (message.includes("Allow JavaScript from Apple Events")) {
    return JS_DISABLED_HINT;
  }
  if (message.includes("-1743") || message.includes("Not authorized")) {
    return (
      "macOS does not allow BB to control Safari. Open System Settings → Privacy & Security → " +
      "Automation and enable Safari under BB."
    );
  }
  // osascript prefixes errors with "<offset>: execution error: ".
  return message.replace(/^\d+:\d+: execution error: /, "");
}

// Shared handlers: resolve "window id or the front browser window" and
// "tab index or the current tab". Settings and other non-browser windows
// have no tabs, so the front browser window is the first one with tabs.
const PRELUDE = `
on browserWindow(w)
  tell application "Safari"
    if w is not "" then return window id (w as integer)
    repeat with candidate in windows
      try
        if (count of tabs of candidate) > 0 then return contents of candidate
      end try
    end repeat
  end tell
  error "Safari has no open browser windows. Open one with safari_open."
end browserWindow

on targetTab(w, t)
  set theWindow to my browserWindow(w)
  tell application "Safari"
    if t is "" then return current tab of theWindow
    return tab (t as integer) of theWindow
  end tell
end targetTab
`;

function osa(body: string, args: string[], timeoutMs = 20_000) {
  const script = `${PRELUDE}\non run argv\n${body}\nend run`;
  return run("/usr/bin/osascript", ["-e", script, ...args], timeoutMs);
}

const refArgs = (ref: TabRef) => [
  ref.window === undefined ? "" : String(ref.window),
  ref.tab === undefined ? "" : String(ref.tab),
];

export async function isRunning(): Promise<boolean> {
  const out = await run(
    "/usr/bin/osascript",
    ["-e", 'application "Safari" is running'],
    5_000,
  );
  return out === "true";
}

// Fields and rows are separated by ASCII unit/record separators so titles
// with tabs or newlines cannot break parsing.
export async function listTabs(): Promise<TabInfo[]> {
  if (!(await isRunning())) return [];
  const out = await osa(
    `
set US to character id 31
set RS to character id 30
set out to ""
tell application "Safari"
  repeat with w in windows
    try
      set wid to id of w
      set cur to index of current tab of w
      set i to 0
      repeat with t in tabs of w
        set i to i + 1
        set u to URL of t
        if u is missing value then set u to ""
        set n to name of t
        if n is missing value then set n to ""
        set out to out & wid & US & i & US & (i = cur) & US & u & US & n & RS
      end repeat
    end try
  end repeat
end tell
return out`,
    [],
  );
  return out
    .split("\x1e")
    .filter((row) => row.trim() !== "")
    .map((row) => {
      const [window, tab, current, url, title] = row.split("\x1f");
      return {
        window: Number(window),
        tab: Number(tab),
        current: current === "true",
        url: url ?? "",
        title: title ?? "",
      };
    });
}

export async function openUrl(
  url: string,
  options: { newTab: boolean; window?: number; tab?: number },
): Promise<TabInfo> {
  const out = await osa(
    `
set u to item 1 of argv
set w to item 2 of argv
set t to item 3 of argv
set newTab to (item 4 of argv) is "true"
tell application "Safari"
  set hasWindow to false
  try
    set theWindow to my browserWindow(w)
    set hasWindow to true
  end try
  if not hasWindow then
    make new document with properties {URL:u}
    set theWindow to my browserWindow("")
    set theTab to current tab of theWindow
  else if newTab then
    set theTab to make new tab at end of tabs of theWindow with properties {URL:u}
    set current tab of theWindow to theTab
  else
    set theTab to my targetTab(w, t)
    set URL of theTab to u
  end if
  return (id of theWindow as text) & "," & (index of theTab as text)
end tell`,
    [url, ...refArgs(options), String(options.newTab)],
  );
  const [window, tab] = out.split(",").map(Number);
  await waitForLoad({ window, tab });
  return describeTab({ window, tab });
}

export async function describeTab(ref: TabRef): Promise<TabInfo> {
  const out = await osa(
    `
set theTab to my targetTab(item 1 of argv, item 2 of argv)
tell application "Safari"
  set theWindow to my browserWindow(item 1 of argv)
  set u to URL of theTab
  if u is missing value then set u to ""
  set n to name of theTab
  if n is missing value then set n to ""
  set US to character id 31
  return (id of theWindow as text) & US & (index of theTab as text) & US & ((current tab of theWindow) = theTab) & US & u & US & n
end tell`,
    refArgs(ref),
  );
  const [window, tab, current, url, title] = out.split("\x1f");
  return {
    window: Number(window),
    tab: Number(tab),
    current: current === "true",
    url: url ?? "",
    title: title ?? "",
  };
}

/** Polls document.readyState; without JS access it waits a fixed moment. */
async function waitForLoad(ref: TabRef, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await sleep(300);
  while (Date.now() < deadline) {
    try {
      const state = await doJavaScript(ref, "document.readyState");
      if (state === "complete") return;
    } catch (error) {
      if (error instanceof SafariError && error.message === JS_DISABLED_HINT) {
        await sleep(2_000);
        return;
      }
    }
    await sleep(250);
  }
}

export async function selectTab(ref: TabRef, activate: boolean) {
  await osa(
    `
set theWindow to my browserWindow(item 1 of argv)
set theTab to my targetTab(item 1 of argv, item 2 of argv)
tell application "Safari"
  set current tab of theWindow to theTab
  set index of theWindow to 1
  if (item 3 of argv) is "true" then activate
end tell`,
    [...refArgs(ref), String(activate)],
  );
  return describeTab({ window: ref.window, tab: undefined });
}

export async function closeTab(ref: TabRef): Promise<TabInfo> {
  const closed = await describeTab(ref);
  await osa(
    `
set theTab to my targetTab(item 1 of argv, item 2 of argv)
tell application "Safari" to close theTab`,
    refArgs(ref),
  );
  return closed;
}

export async function readTab(
  ref: TabRef,
  format: "text" | "html",
): Promise<string> {
  return osa(
    `
set theTab to my targetTab(item 1 of argv, item 2 of argv)
tell application "Safari"
  if (item 3 of argv) is "html" then
    set pageContent to source of theTab
  else
    set pageContent to text of theTab
  end if
end tell
if pageContent is missing value then return ""
return pageContent`,
    [...refArgs(ref), format],
  );
}

function doJavaScript(ref: TabRef, source: string): Promise<string> {
  return osa(
    `
set theTab to my targetTab(item 1 of argv, item 2 of argv)
tell application "Safari" to set r to do JavaScript (item 3 of argv) in theTab
if r is missing value then return ""
return r as text`,
    [...refArgs(ref), source],
  );
}

/**
 * Runs `code` as the body of an async function in the page and returns the
 * JSON of its return value. `do JavaScript` cannot await, so the promise
 * settles into a page global that is polled. The body is inlined rather
 * than eval'd so pages whose CSP forbids eval still work.
 */
export async function evaluate(
  ref: TabRef,
  code: string,
  timeoutMs: number,
): Promise<unknown> {
  const key = `__bbSafari_${randomUUID().replaceAll("-", "")}`;
  const slot = `window[${JSON.stringify(key)}]`;
  await doJavaScript(
    ref,
    `${slot} = { done: false };
(async function () {
${code}
})().then(
  (value) => { ${slot} = { done: true, ok: true, value: value === undefined ? null : value }; },
  (error) => { ${slot} = { done: true, ok: false, error: String(error && error.stack || error) }; },
);
"started";`,
  );
  const read = `(() => { const s = ${slot}; if (!s || !s.done) return "";
delete ${slot};
try { return JSON.stringify(s); } catch (e) { return JSON.stringify({ ok: true, value: String(s.value) }); } })()`;
  const deadline = Date.now() + timeoutMs;
  for (let delay = 20; ; delay = Math.min(delay * 2, 250)) {
    const out = await doJavaScript(ref, read);
    if (out !== "") {
      const settled = JSON.parse(out) as
        | { ok: true; value: unknown }
        | { ok: false; error: string };
      if (!settled.ok) throw new SafariError(`Page script threw: ${settled.error}`);
      return settled.value;
    }
    if (Date.now() > deadline) {
      throw new SafariError(`Page script did not settle within ${timeoutMs} ms`);
    }
    await sleep(delay);
  }
}

/**
 * Captures a Safari window as JPEG. macOS does not render web content of a
 * covered window, so Safari is raised for the capture and the previously
 * frontmost app is reactivated afterwards.
 */
export async function screenshot(
  ref: TabRef,
  maxSize: number,
): Promise<{ path: string; base64: string; tab: TabInfo }> {
  const front = await frontmostBundleId();
  const tab = await selectTab(ref, true);
  const dir = join(tmpdir(), "bb-safari");
  await mkdir(dir, { recursive: true });
  const stem = join(dir, `safari-${Date.now()}`);
  try {
    await sleep(700);
    await run(
      "/usr/sbin/screencapture",
      ["-x", "-o", `-l${tab.window}`, `${stem}.png`],
      15_000,
    );
  } finally {
    if (front !== null && front !== "com.apple.Safari") {
      await run(
        "/usr/bin/open",
        ["-b", front],
        5_000,
      ).catch(() => undefined);
    }
  }
  await run(
    "/usr/bin/sips",
    ["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", String(maxSize), `${stem}.png`, "--out", `${stem}.jpg`],
    15_000,
  );
  await rm(`${stem}.png`, { force: true });
  const base64 = (await readFile(`${stem}.jpg`)).toString("base64");
  return { path: `${stem}.jpg`, base64, tab };
}

async function frontmostBundleId(): Promise<string | null> {
  try {
    const asn = await run("/usr/bin/lsappinfo", ["front"], 5_000);
    const info = await run(
      "/usr/bin/lsappinfo",
      ["info", "-only", "bundleid", asn],
      5_000,
    );
    return /"CFBundleIdentifier"="([^"]+)"/.exec(info)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function javascriptAllowed(): Promise<boolean | null> {
  try {
    await doJavaScript({}, "1");
    return true;
  } catch (error) {
    if (error instanceof SafariError && error.message === JS_DISABLED_HINT) {
      return false;
    }
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
