---
name: recent-threads
description: "Switch the sidebar thread list between bb's full list and the Recent view, which shows only threads the user wrote in during the last 1–24 hours, grouped by project."
---

# Recent threads view

The plugin registers a sidebar thread list `recent-threads/recent`. It lists
active (not archived, not hidden) threads that have a user prompt in bb's
prompt history, or an unsent draft, within the chosen window (1, 4, 12 or 24
hours; default 4):

- «Ждут тебя» first: threads waiting for the user (a question, a failure, or
  an unread finished turn), newest attention first.
- Then projects sorted by name; threads inside, newest prompt first.
- Subagent threads nest, folded, under their recent parent thread.

Group headers fold; folded groups still show the open thread.

The user switches views with the clock button in the sidebar footer (or the
More menu), ⌘⇧R, the command palette entry «Список тредов: недавние / все»,
or «Все» at the top of the Recent view. The toggle writes the server-synced
UI preference `sidebar.threadListProvider`, so every open client follows it.

From a terminal:

```sh
bb settings ui set sidebar.threadListProvider recent-threads/recent     # Recent
bb settings ui set sidebar.threadListProvider thread-list/thread-list   # bb's list
```

The window, folded groups and unfolded subagents are per browser
(localStorage) and change only in the app.
