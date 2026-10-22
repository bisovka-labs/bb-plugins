---
name: openui
description: Show structured results as live interactive UI inline in BB chat — dashboards, KPI cards, charts, comparison tables, forms, option pickers — by writing an OpenUI Lang (.oui) file and emitting the ::openui directive. Use when a card, chart, table or form communicates the answer better than prose, or when the user asks for "OpenUI", generative UI, or a quick dashboard in chat.
---

# OpenUI in BB chat

The OpenUI plugin renders an OpenUI Lang program, a line-based language for
composing UI from a fixed component library, as an interactive card inside your
message. You write the program to a file, then point a directive at it.

## Workflow

1. Write the program to a `.oui` file. For a one-off result, prefer thread storage:
   `$BB_THREAD_STORAGE/openui/<name>.oui`. Use the workspace only when the
   user wants the file kept in the project.
2. Emit the directive as its own paragraph. Never put it inside backticks or a code fence.

```text
::openui{source="thread-storage" file="openui/sales.oui"}
::openui{file="ui/sales.oui"}
```

`source` is `thread-storage` or `workspace` (default). `file` is relative to
that source, contains no `..`, and ends in `.oui` or `.openui`. Emit the
directive only after the file exists. Files are capped at 512 KiB.

## Language essentials

Read [reference.md](reference.md) before writing anything beyond a trivial card. It is
generated from the exact library the plugin renders and lists every component
signature and rule. The reference was written as a chat system prompt, so read
"your response" as "the .oui file". Keep the rest of your chat message in
normal Markdown.

- One statement per line: `name = Expression`. Start with `root = Card([...])`.
- Arguments are positional: `BarChart(labels, [series])`, never `labels: ...`.
- Every variable except `root` must be referenced, or it silently does not render.
- Strings use double quotes. Escape inner quotes with `\"`.

```text
root = Card([header, kpis, chart, actions])
header = CardHeader("Q3 revenue", "All regions, USD")
kpis = OverviewCardBlock([k1, k2])
k1 = OverviewCardItem("revenue", Text("text", "Revenue"), MetricIndicatorInline("$1.24M", "vs Q2", {direction: "up", value: 18}))
k2 = OverviewCardItem("deals", Text("text", "Closed deals"), MetricIndicatorInline("312", "vs Q2", {direction: "up", value: 9}))
chart = BarChart(["Jul", "Aug", "Sep"], [Series("Revenue", [380, 410, 450])])
actions = Buttons([Button("Break down by region", @ToAssistant("Break Q3 revenue down by region"))])
```

## Buttons and forms

- `@ToAssistant("text", context?)` sends `text` as the user's next message in
  this thread. Form values and `context` go into a JSON block appended to that
  message. If the user has an unsent draft, the text goes into the draft instead.
  A button without an action sends its own label.
- `@OpenUrl("https://…")` opens an http(s) link in a new tab.
- `Query()` / `Mutation()` tool calls are not wired up in BB. Put the data
  into the program directly.

## Checking your output

Parse and runtime errors appear as a one-line note under the card. If the
user reports a blank or broken card, re-read the reference for that component's
signature and rewrite the file. A re-emitted directive (or a reload) picks up
the new content.
