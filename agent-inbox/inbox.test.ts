import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyReview,
  reason,
  reconcile,
  needsReview,
  parseLedger,
  type InboxThread,
} from "./inbox.ts";
const thread = (patch: Partial<InboxThread> = {}): InboxThread => ({
  id: "thr_test",
  status: "idle",
  hasPendingInteraction: false,
  isUnread: true,
  indicator: "unread-success",
  queuedWork: "none",
  latestAttentionAt: 100,
  isArchived: false,
  isHidden: false,
  ...patch,
});
test("reading embedded chat retains an item until explicit review", () => {
  const ledger = reconcile({}, [thread()]);
  const read = thread({ isUnread: false });
  assert.equal(needsReview(read, reconcile(ledger, [read]), 0), true);
  const reviewed = { ...ledger, thr_test: { attention: 100, reviewed: 100 } };
  assert.equal(needsReview(read, reviewed, 0), false);
  assert.equal(
    needsReview(
      thread({ latestAttentionAt: 200 }),
      reconcile(reviewed, [thread({ latestAttentionAt: 200 })]),
      0,
    ),
    true,
  );
});
test("running work stays quiet except an explicit question", () => {
  assert.equal(
    needsReview(
      thread({ status: "active" }),
      reconcile({}, [thread({ status: "active" })]),
      0,
    ),
    false,
  );
  const t = thread({
    status: "active",
    hasPendingInteraction: true,
    isUnread: false,
  });
  assert.equal(needsReview(t, reconcile({}, [t]), 0), true);
});
test("snooze expires and new attention cancels it", () => {
  const ledger = { thr_test: { attention: 100, snoozeUntil: 1000 } };
  assert.equal(needsReview(thread(), ledger, 999), false);
  assert.equal(needsReview(thread(), ledger, 1000), true);
  const newer = thread({ latestAttentionAt: 200 });
  assert.equal(needsReview(newer, reconcile(ledger, [newer]), 999), true);
});
test("hidden and archived threads are removed; malformed storage is ignored", () => {
  assert.deepEqual(
    reconcile({ thr_test: { attention: 100 } }, [thread({ isArchived: true })]),
    {},
  );
  assert.equal(
    needsReview(
      thread({ isHidden: true }),
      { thr_test: { attention: 100 } },
      0,
    ),
    false,
  );
  assert.deepEqual(parseLedger("{"), {});
  assert.deepEqual(
    parseLedger('{"thr_bad":{"attention":"100"},"thr_ok":{"attention":100}}'),
    { thr_ok: { attention: 100 } },
  );
});
test("blocking questions and failed queued sends cannot be dismissed", () => {
  const ledger = { thr_test: { attention: 100, reviewed: 100 } };
  assert.equal(
    needsReview(thread({ hasPendingInteraction: true }), ledger, 0),
    true,
  );
  assert.equal(needsReview(thread({ queuedWork: "failed" }), ledger, 0), true);
});

test("a newer attention event survives a stale review or snooze action", () => {
  const ledger = { thr_test: { attention: 200 } };
  assert.deepEqual(applyReview(ledger, thread()), ledger);
  assert.deepEqual(applyReview(ledger, thread(), 1000), ledger);
  assert.equal(
    needsReview(thread({ latestAttentionAt: 200 }), ledger, 0),
    true,
  );
});
test("a read failure keeps its error label", () => {
  assert.equal(
    reason(thread({ status: "error", isUnread: false, indicator: "none" })),
    "error",
  );
});
