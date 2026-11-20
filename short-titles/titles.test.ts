import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTitle, titleContext } from "./titles.ts";

const BB_TITLE = `You create concise titles for coding tasks.
Reply with only the title: short, clear. Keep it under about 40 characters.

The prompt invokes these commands or skills: /research. They name how the work is carried out.

Task:
сравни локальные модели

The thread is currently titled "Long old title here".`;

test("title prompt keeps the task context and drops bb's rules", () => {
  const context = titleContext(BB_TITLE);
  assert.ok(context?.startsWith("The prompt invokes these commands"));
  assert.ok(context?.includes("Task:\nсравни локальные модели"));
  assert.ok(context?.includes("currently titled"));
  assert.ok(!context?.includes("40 characters"));
});

test("title prompt without commands starts at the task", () => {
  assert.equal(titleContext("You create concise titles.\n\nTask:\nfix CI"), "Task:\nfix CI");
});

test("other prompts pass through", () => {
  assert.equal(titleContext("Write a commit message for this diff:\n+a"), null);
  assert.equal(titleContext("Write a commit message.\n\nTask:\nx"), null);
});

test("cleanTitle strips wrapping and caps the word count", () => {
  assert.equal(cleanTitle('"Красный CI".', 3), "Красный CI");
  assert.equal(cleanTitle("<think>hm</think>\nTitle: Onboarding v3\nextra", 3), "Onboarding v3");
  assert.equal(cleanTitle("Аудит GBrain и research pipeline", 3), "Аудит GBrain и");
  assert.equal(cleanTitle("«Короткие названия»", 2), "Короткие названия");
  assert.equal(cleanTitle("  \n ", 3), "");
});
