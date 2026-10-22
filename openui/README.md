# bb-plugin-openui

Renders [OpenUI](https://www.openui.com/) Lang generative UI (cards, charts,
tables, forms) inline in bb assistant messages.

An agent writes an OpenUI Lang program to a `.oui` file and emits:

```text
::openui{source="thread-storage" file="openui/sales.oui"}
::openui{file="ui/sales.oui"}
```

- `server.ts`: the `loadSpec` RPC reads the file from the thread's workspace or
  thread storage. It stays confined to that root, accepts only `.oui`/`.openui`,
  and caps files at 512 KiB. `GET /renderer` serves one self-contained HTML page
  with the vendored OpenUI renderer (ETag, `no-cache`).
- `app.tsx`: the `openui` message directive. It renders the page in an
  opaque-origin `sandbox="allow-scripts"` iframe and posts the spec and theme
  into it. It sizes the frame to the content and handles actions:
  `@ToAssistant` sends a message to the thread (form values and context go in a
  JSON block, and an unsent draft gets the text appended instead), and
  `@OpenUrl` opens http(s) links in a new tab.
- `skills/openui/`: the agent skill. `reference.md` is the component reference
  generated from the exact library that is rendered.
- `vendor/`: `@openuidev/browser-bundle` (MIT) plus the library's dark theme as CSS.

Not wired up: OpenUI `Query()`/`Mutation()` tool calls and custom actions.

## Develop

```sh
npm install
npm run vendor      # refresh vendor/ and skills/openui/reference.md after bumping @openuidev/*
npm run typecheck
bb plugin build
bb plugin install . --yes   # or: bb plugin reload openui
```
