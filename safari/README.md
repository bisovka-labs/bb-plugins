# bb-plugin-safari

Lets bb agents drive your real Safari on macOS: list tabs, open pages, read
text or HTML, click, fill forms, run JavaScript, and take screenshots. It
uses AppleScript, so agents work inside your signed-in Safari session.

Agent tools: `safari_tabs`, `safari_open`, `safari_select`, `safari_read`,
`safari_js`, `safari_click`, `safari_fill`, `safari_screenshot`,
`safari_close`. CLI: `bb safari status|tabs|open|read|js|screenshot|close`.

## Requirements

- The bb server runs on the Mac with Safari. The plugin does nothing on other
  platforms.
- macOS asks once to let bb control Safari (Privacy & Security → Automation).
- For `safari_js`, `safari_click`, and `safari_fill`: Safari → Settings →
  Advanced → «Show features for web developers», then Settings → Developer →
  «Allow JavaScript from Apple Events».
- For screenshots: Screen Recording permission for bb.

`bb safari status` checks all of this. No settings. See
`skills/safari/SKILL.md` for the agent contract.
