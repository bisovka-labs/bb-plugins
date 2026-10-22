---
name: todo
description: The user's personal todo list (the Todo page in the BB sidebar), grouped by project with priorities. Use when the user says «поставь в туду», «закинь в тудулист», «в задачи», «добавь задачу», or asks what is on the list, to close, reprioritize, or move a task.
---

# Todo

One personal list for tasks the user will do themselves later, carefully, at
their computer. The Todo page in the BB sidebar, the `todo_add` / `todo_list`
agent tools, and the `bb todo` CLI read and write the same list.

## Adding a task

Prefer the `todo_add` tool; use `bb todo add` when the tool is not available.

- `title` — short actionable phrase in Russian (or the user's language),
  starting with a verb: «Разобрать логи деплоя api».
- `notes` — self-contained context the user needs later without this
  conversation: what was found, the exact text they pointed at («вот то, что он
  написал»), links, file paths, commands. Quote rather than paraphrase.
- `project` — omit to use the current thread's BB project. Pass it when the
  user names a project or the task clearly belongs elsewhere. Run
  `bb todo projects` to reuse an existing spelling.
- `priority` — `high` when the user says срочно/важно/в первую очередь,
  `low` for «когда-нибудь»/«потом», otherwise omit (`normal`).

Add several tasks as separate calls. Confirm in one line what was added and
to which project.

## Commands

| Command | Effect |
| --- | --- |
| `bb todo list [--all] [--project <name>]` | Open tasks by project; `--all` adds done ones. |
| `bb todo add <title> [--project P] [--priority high\|normal\|low] [--notes "…"]` | Add a task. |
| `bb todo done <id>` / `bb todo undo <id>` | Close or reopen. |
| `bb todo edit <id> [--title …] [--project …] [--priority …] [--notes …]` | Change a task. |
| `bb todo remove <id>` | Delete (only when asked or for a duplicate). |
| `bb todo projects` | Project names already in use. |

Add `--json` when output drives code. In list output `!!` is high, `·` normal,
`··` low. Never guess an id: list first. Change the list only through these
tools and commands, never through the plugin's database.
