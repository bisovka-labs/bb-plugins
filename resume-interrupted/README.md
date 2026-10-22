# Resume Interrupted

BB plugin: when BB restarts, threads whose running turn was cut off by the
host-daemon restart (red ⊗ in the sidebar, "Thread interrupted because the host
daemon disconnected") get the message «продолжи».

- Startup sweep at 10 s, 60 s and 3 min after the plugin loads, plus a live
  check on `thread.failed` for daemon-only restarts.
- Only visible, unarchived, user-owned threads in `error` whose newest turn
  boundary is `system/thread/interrupted` with reason `host-daemon-restarted`,
  no older than 6 hours. Plugin-owned threads (Factory workers) are skipped:
  they recover on their own. Other failures (rate limits, crashes) are untouched.
- One «продолжи» per interruption (interrupt event id kept in plugin kv).

```
npm install && npm test && npx tsc --noEmit
bb plugin build && bb plugin install . --yes
```

Log lines: `grep resume-interrupted ~/.bb/logs/server-stdio.log`.
