# Hide Empty Projects

BB plugin: a project with no threads of its own in the sidebar leaves the
thread list and comes back as soon as a thread appears in it. A project counts
as empty when it has no unpinned, unarchived root thread: a child shows under
its parent (even in another project) and a pinned thread shows in Pinned. The project
itself is untouched, so it stays in the new-thread project picker and recent
projects.

How: it drives bb's Thread list `hiddenGroups` preference (the same as a
group's "Hide from list"), and `app.tsx` also removes empty projects from the
More menu, so only projects you hid by hand that still have threads stay there.
The last row of More, «Показать пустые проекты (N)», brings the empty ones
back into More until the menu closes.

- Syncs 5 s after load, 1.5 s after a thread is created, archived, unarchived
  or deleted, and every 5 minutes.
- Only shows projects it hid itself. A project you hid by hand stays hidden.
- If you show an empty project again by hand, it stays until it gets a
  thread; after that it hides again when it empties.
- On the first run, projects that were already hidden while empty are treated
  as its own, so they come back once they get a thread.
- State (`autoHidden`, `keepVisible`) lives in the plugin kv.

No settings or commands. Disable the plugin to stop; to show everything,
`bb thread-list prefs reset hiddenGroups`.

```
npm install && npm test && npx tsc --noEmit
bb plugin build && bb plugin install . --yes
```

Log lines: `grep hide-empty-projects ~/.bb/logs/server-stdio.log`.
