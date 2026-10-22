Let agents answer with live UI instead of walls of text: KPI cards, charts,
tables, comparison grids, and forms, rendered inline in the chat.

## What you get

- An `::openui{file="…"}` directive that renders an OpenUI Lang file as an interactive card.
- Buttons and forms that reply to the agent: a click sends the follow-up message
  with the form values attached.
- Light and dark themes that follow bb.

## How it works

The agent writes a small OpenUI Lang program to the workspace or thread storage.
bb renders it with the open-source OpenUI renderer inside a sandboxed frame that
cannot reach the bb page, cookies, or storage. Nothing is sent to OpenUI or any
other service.
