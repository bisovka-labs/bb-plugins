# bb-plugin-todo

Personal todo list for BB: a sidebar page, agent tools `todo_add` /
`todo_list`, and `bb todo`. Tasks have a project (defaults to the calling
thread's BB project, else `Inbox`), a priority (`high`/`normal`/`low`),
notes, and the source thread.

```
bb plugin install .
bb todo add "Разобрать логи" --project Acme --priority high --notes "…"
bb todo list
```

See `skills/todo/SKILL.md` for the agent contract.
