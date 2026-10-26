---
name: safari
description: Drive the user's real Safari on the Mac running BB (their tabs, cookies, and logins). Use when the user asks to open, read, click, fill, or screenshot something «в сафари» / in Safari, or to work with a page already open there.
---

# Safari

The `safari_*` agent tools and the `bb safari` CLI control the user's own
Safari through AppleScript on the machine where the BB server runs. It is
the user's everyday browser, not a sandbox: every action happens in their
signed-in session.

## Tools

| Tool | Does | Needs JavaScript access |
| --- | --- | --- |
| `safari_tabs` | List windows and tabs: window id, tab index, title, URL | no |
| `safari_open` | Open a URL in a new tab (default) or navigate a tab, wait for load | no |
| `safari_select` | Make a tab current; `activate` brings Safari to the front | no |
| `safari_read` | Visible text (default) or HTML source of a tab | no |
| `safari_screenshot` | JPEG of the window showing the tab | no |
| `safari_close` | Close a tab | no |
| `safari_js` | Run an async function body in the page, return JSON | yes |
| `safari_click` | Click by CSS selector or visible text | yes |
| `safari_fill` | Set an input/textarea/select/checkbox, optional submit | yes |

`window` and `tab` default to the front window and its current tab. Window
ids are stable; tab indexes shift when tabs open or close, so re-run
`safari_tabs` after closing tabs.

## Working rules

- Open pages in a new tab; never navigate away from a tab the user had open
  unless asked. Close the tabs you opened when done.
- Prefer `safari_read` to understand a page, `safari_screenshot` to check
  layout or a visual result.
- `safari_js` code is the body of an async function: `return` the value,
  `await` is allowed, results must be JSON-serializable. Keep results small.
- Clicks and typing are synthetic DOM events (`isTrusted` false). Sites that
  demand trusted input (some payment widgets, captchas) will not react; say
  so instead of retrying.
- Do not submit purchases, payments, messages, or other irreversible forms
  without the user's explicit go-ahead.
- `safari_screenshot` raises Safari for under a second, because macOS does
  not render covered windows, then returns focus to the previous app.

## Setup and errors

- «macOS does not allow BB to control Safari»: System Settings → Privacy &
  Security → Automation → enable Safari under BB.
- «Safari blocks JavaScript from automation»: the user must turn it on once
  (it asks for their password, so the agent cannot): Safari → Settings →
  Advanced → «Show features for web developers», then Settings → Developer →
  «Allow JavaScript from Apple Events». Until then `safari_js`,
  `safari_click`, and `safari_fill` fail; the other tools work.
- Screenshot shows only the wallpaper: grant BB Screen Recording in System
  Settings → Privacy & Security.

## CLI

```
bb safari status                         # automation + JavaScript access
bb safari tabs
bb safari open <url> [--here] [--window <id>] [--tab <n>]
bb safari read [--html] [--window <id>] [--tab <n>]
bb safari js '<async function body>' [--window <id>] [--tab <n>]
bb safari screenshot [--window <id>] [--tab <n>]   # prints the JPEG path
bb safari close [--window <id>] [--tab <n>]
```
