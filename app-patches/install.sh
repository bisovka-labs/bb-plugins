#!/bin/sh
# Copy these bb.app patches to ~/.bb/patches and register the LaunchAgent that
# re-applies them whenever bb.app updates. The patches run from ~/.bb/patches,
# not from this checkout: macOS blocks a LaunchAgent's /bin/sh from reading
# ~/Documents. Rerun after editing a patch here.
set -e
SRC=$(cd "$(dirname "$0")" && pwd)
DEST="$HOME/.bb/patches"
LABEL=dev.bisovka.bb-patches
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$DEST"
rsync -a --exclude install.sh --exclude .gitignore "$SRC"/ "$DEST"/

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$DEST/apply-all.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WatchPaths</key>
  <array>
    <string>/Applications/bb.app/Contents/Info.plist</string>
  </array>
  <key>StartInterval</key>
  <integer>600</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$DEST/apply.log</string>
  <key>StandardErrorPath</key>
  <string>$DEST/apply.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# Attached videos are deleted after N days (video-cleanup/video-cleanup.py).
CLEAN_LABEL=dev.bisovka.bb-video-cleanup
CLEAN_PLIST="$HOME/Library/LaunchAgents/$CLEAN_LABEL.plist"
cat > "$CLEAN_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$CLEAN_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DEST/video-cleanup/video-cleanup.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key>
  <integer>21600</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$DEST/video-cleanup.log</string>
  <key>StandardErrorPath</key>
  <string>$DEST/video-cleanup.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)" "$CLEAN_PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$CLEAN_PLIST"

/bin/sh "$DEST/apply-all.sh" --force
