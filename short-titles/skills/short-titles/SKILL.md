---
name: short-titles
description: Explains and configures the Short Titles plugin, which names bb threads in one or two words through an OpenAI-compatible model.
---

# Short Titles

The plugin registers the AI service `short` (plugin `short-titles`) for bb's
thread-title task. bb asks it for a title when a thread starts and when the
user picks Regenerate title; the plugin swaps bb's "under 40 characters" rules
for "1-2 words, 3 at most, name the subject" and cleans the reply.

Turn it on (one time):

```bash
bb settings ai-services set thread-title short --plugin short-titles
bb settings ai-services test thread-title
```

bb waits 5 seconds for a title. When a new thread is still untitled after
`retrySeconds` (and again after three times that), the plugin calls bb's
title regeneration for it, which by then also sees the agent's first replies.
Threads whose first message has fewer than five words keep that message as
the title: bb does not ask any service for those.

Settings (`bb plugin config short-titles set <key> <value>`):

- `baseUrl`: OpenAI-compatible endpoint ending in `/v1`; default local Ollama.
- `model`: a small fast model; default `qwen3.5:4b`.
- `apiKey`: secret, only for endpoints that need one.
- `maxWords`: hard cap on words in a title; default 3.
- `retrySeconds`: delay before the retry; 0 turns the retry off.

Retitle one thread by hand: `bb thread regenerate-title <id>`.
Failures are in `bb plugin logs short-titles` and in the server log under
`task: thread-title`.

The service also shows up for commit messages; there it forwards bb's prompt
to the same model unchanged.
