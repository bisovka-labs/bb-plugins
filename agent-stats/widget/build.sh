#!/bin/sh
# Builds the desktop widget into ~/Applications/Agent Stats Widget.app and (re)starts it.
set -eu
cd "$(dirname "$0")"
APP="$HOME/Applications/Agent Stats Widget.app"

mkdir -p build
bun build widget.tsx --outfile build/widget.js --minify --target browser --format iife --define 'process.env.NODE_ENV="production"'
# Inline the bundle: WebKit masks errors from file:// scripts, and one file is simpler to ship.
python3 -c 'import sys; h = open("index.html").read(); js = open("build/widget.js").read().replace("</script", "<\\/script"); open("build/index.html", "w").write(h.replace("<script src=\"widget.js\"></script>", "<script>" + js + "</script>"))'
swiftc -O AgentStatsWidget.swift -o build/AgentStatsWidget

pkill -x AgentStatsWidget 2>/dev/null || true
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/"
cp build/AgentStatsWidget "$APP/Contents/MacOS/"
cp build/index.html "$APP/Contents/Resources/"
codesign --force --sign - "$APP"
open "$APP"
echo "Installed: $APP"
