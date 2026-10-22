# bb-plugin-copy-file

A **Copy file** button in the header of bb's file viewer, after Refresh / Copy
contents / Open in editor. It puts the file itself on the macOS clipboard, the
same thing Finder's ⌘C does, so you can paste it into Finder, Telegram or Mail.

In a browser (remote access) a page can't put a file on the clipboard, so the
button instead:

- copies images (png, jpg, gif, webp) to the clipboard as PNG;
- opens the share sheet for other files (iOS offers "Copy" there; Safari may
  ask for a second click once the file has downloaded);
- downloads the file when sharing is unavailable or refused.

Browser downloads go through RPC in 4 MB chunks, up to 100 MB per file.

- `app.tsx`: bb has no slot for file-header actions, so an app overlay adds the
  button next to the header's path button. It reads the path and thread context
  from that header's React props.
- `server.ts`: resolves the shown path to an absolute one on this Mac. Workspace
  files are worktree-relative and thread-storage files storage-relative.
- `host.ts`: writes the file URL to `NSPasteboard` through `osascript -l JavaScript`,
  or reads file chunks for the browser.

Only files on the bb server's own Mac can be copied.

```sh
npm install
bb plugin build
bb plugin install .
```
