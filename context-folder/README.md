# bb-plugin-context-folder

Adds **Select folder** to the composer's `+` menu. Pick a bb project or browse
to any folder on the server machine; it lands in the message as a pill. When
the message is sent, the agent gets an agent-only note with the folder's
absolute path and its top-level entries, so it knows where to look.

- Projects come first; typing filters them and the folder list. Opening a
  folder switches to browsing. Type `~/…` or `/…` and press Enter to jump.
- Several folders per message are fine. Typing `@` plus a project name also
  offers projects under "Context folders".
- The plugin does not change the provider sandbox (`--add-dir`, Codex
  writable roots): bb's dispatch hook can only allow or reject a send. Claude
  Code reaches the folder through `additionalDirectories` in
  `~/.claude/settings.json`; a sandboxed Codex thread can read it but may not
  write there.
- Only folders on the bb server machine are listed and resolved.

Develop: `npm install`, `bb plugin build .`, `bb plugin reload context-folder`.
