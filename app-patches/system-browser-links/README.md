# BB system browser links

Installed in BB 0.46.1 on 2026-10-18. `../system-browser-links.py` appends
`links.js` to the renderer entry and discovers the existing external-browser
and clipboard helpers. The existing `apply-all.sh` includes this patch after
updates. It fails before writing if the helpers change shape.

Command-click (Control-click on other platforms) on an absolute HTTP(S) link
uses BB's desktop `openExternalUrl` bridge, or its normal web/native fallback.
Right-click offers **Open in system browser** and **Copy link**. Ordinary
clicks, relative BB links, file links, and other protocols retain their handlers.

The original renderer is saved alongside the existing patch backups as
`~/.bb/index-DLL4t6p_.js.pre-system-browser-links`. Do not copy it over a newer
version or other subsequent edits.

Verification: installed JS parses; gzip matches; import map uses the new content
hash; repeat application detects the marker. Twenty UI assertions in `verify.js`
passed in BB Browser Automation on host `host_wp7fp32975`, including modifier
clicks, nested content, exactly one bridge call, ordinary clicks, menu actions,
keyboard, focus restoration, viewport bounds, outside dismissal, and preserved
internal/unsupported links. The bridge was stubbed during these assertions;
launching the native macOS browser was not exercised. A separate real menu click
without a stub opened the expected TestFlight URL in a new browser page. The
rendered menu was inspected at 1280 x 633.

Open BB windows need a reload to load the patched renderer.
