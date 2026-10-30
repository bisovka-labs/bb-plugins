import { test } from "node:test";
import assert from "node:assert/strict";
import { plan } from "./plan.ts";

const S = (autoHidden: string[] = [], keepVisible: string[] = []) => ({ autoHidden, keepVisible });

test("hides empty projects and keeps busy ones", () => {
  const r = plan(["a", "b"], new Set(["a"]), ["threads"], S());
  assert.deepEqual(r.hiddenGroups, ["threads", "project:b"]);
  assert.deepEqual(r.state, S(["b"]));
  assert.equal(r.changed, true);
});

test("shows a project it hid once a thread appears", () => {
  const r = plan(["a", "b"], new Set(["a", "b"]), ["project:b"], S(["b"]));
  assert.deepEqual(r.hiddenGroups, []);
  assert.deepEqual(r.state, S());
});

test("never shows a project the user hid by hand", () => {
  const r = plan(["a"], new Set(["a"]), ["project:a"], S());
  assert.deepEqual(r.hiddenGroups, ["project:a"]);
  assert.equal(r.changed, false);
});

test("respects a manual unhide until the project gets a thread", () => {
  const unhidden = plan(["b"], new Set(), [], S(["b"]));
  assert.deepEqual(unhidden.hiddenGroups, []);
  assert.deepEqual(unhidden.state, S([], ["b"]));
  const busy = plan(["b"], new Set(["b"]), [], unhidden.state);
  assert.deepEqual(busy.state, S());
  const emptyAgain = plan(["b"], new Set(), [], busy.state);
  assert.deepEqual(emptyAgain.hiddenGroups, ["project:b"]);
});

test("first run adopts projects already hidden while empty", () => {
  const r = plan(["a", "b"], new Set(["b"]), ["project:a", "project:b"], null);
  assert.deepEqual(r.state, S(["a"]));
  const later = plan(["a", "b"], new Set(["a", "b"]), r.hiddenGroups, r.state);
  assert.deepEqual(later.hiddenGroups, ["project:b"]);
});

test("forgets deleted projects", () => {
  const r = plan([], new Set(), ["project:gone"], S(["gone"], ["x"]));
  assert.deepEqual(r.state, S());
  assert.equal(r.changed, false);
});
