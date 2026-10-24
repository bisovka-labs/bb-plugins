#!/bin/sh
# Apply every BB patch in this folder (each one skips itself if already applied),
# then refresh the cache-busting import map. Run by the dev.bisovka.bb-patches
# LaunchAgent whenever bb.app changes, so patches survive updates on their own.
cd "$(dirname "$0")" || exit 1
PLIST=/Applications/bb.app/Contents/Info.plist
VERSION=$(defaults read "$PLIST" CFBundleShortVersionString 2>/dev/null)
[ -n "$VERSION" ] || exit 0
[ "$VERSION" = "$(cat .applied-version 2>/dev/null)" ] && [ "$1" != "--force" ] && exit 0
sleep 20  # let an in-progress update finish writing the bundle
echo "$(date) bb $VERSION"
r=0
reload=
for p in *.py; do
  [ "$p" = cache-bust.py ] && continue
  out=$(python3 "$p" 2>&1); c=$?
  echo "  $p: $(echo "$out" | tail -1)"
  case "$out" in *"patched /"*"/app/dist/"*) reload=1 ;; esac
  case "$out" in *"already patched"*) ;; *) [ $c -eq 0 ] || r=$c ;; esac
done
python3 cache-bust.py || r=$?
# bb relaunches after an update before the patches land, so open windows keep
# the unpatched renderer until reloaded.
[ -n "$reload" ] && osascript -e 'display notification "Патчи применены — нажми ⌘R в окне bb" with title "bb '"$VERSION"'"'
[ $r -eq 0 ] && echo "$VERSION" > .applied-version
exit $r
