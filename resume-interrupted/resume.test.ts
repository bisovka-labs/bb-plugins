import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_AGE_MS, shouldResume, type LatestEvent, type ThreadFacts } from "./resume.ts";

const now = 1_800_000_000_000;
const thread: ThreadFacts = { status: "error", archivedAt: null, originKind: null, originPluginId: null, visibility: "visible" };
const interrupted: LatestEvent = {
  id: "evt_1",
  type: "system/thread/interrupted",
  createdAt: now - 60_000,
  data: { reason: "host-daemon-restarted" },
};

test("resumes a visible errored thread interrupted by a daemon restart", () => {
  assert.equal(shouldResume(thread, interrupted, now), true);
});

test("skips threads that are not in error, archived, hidden or plugin-owned", () => {
  assert.equal(shouldResume({ ...thread, status: "idle" }, interrupted, now), false);
  assert.equal(shouldResume({ ...thread, archivedAt: now }, interrupted, now), false);
  assert.equal(shouldResume({ ...thread, visibility: "hidden" }, interrupted, now), false);
  assert.equal(shouldResume({ ...thread, originKind: "plugin" }, interrupted, now), false);
  // Factory workers carry only originPluginId (originKind stays null).
  assert.equal(shouldResume({ ...thread, originPluginId: "bisovka-factory" }, interrupted, now), false);
});

test("skips other failures, other interrupt reasons and turns started after the interrupt", () => {
  assert.equal(shouldResume(thread, undefined, now), false);
  assert.equal(shouldResume(thread, { ...interrupted, type: "turn/started", data: {} }, now), false);
  assert.equal(shouldResume(thread, { ...interrupted, data: { reason: "user-stopped" } }, now), false);
});

test("skips stale interruptions", () => {
  assert.equal(shouldResume(thread, { ...interrupted, createdAt: now - MAX_AGE_MS - 1 }, now), false);
});
