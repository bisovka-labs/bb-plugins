#!/bin/sh
# Brings Tailscale back up if it is not Running (an app update can leave it stopped,
# and then none of your devices reach bb). Run by a LaunchAgent every 2 minutes.
# Flags you passed to `tailscale up` before go into TS_UP_FLAGS, e.g. "--accept-routes".
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
[ -x "$TS" ] || TS=$(command -v tailscale) || exit 0
LOG="$HOME/Library/Logs/bb-guard/tailscale-watchdog.log"
state=$("$TS" status --json 2>/dev/null | /usr/bin/python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("BackendState",""))
except Exception: print("")')
[ "$state" = "Running" ] && exit 0
# NeedsLogin is a job for a human; do not loop on it.
[ "$state" = "NeedsLogin" ] && { echo "$(date '+%F %T') NeedsLogin: sign in to Tailscale" >> "$LOG"; exit 0; }
echo "$(date '+%F %T') backend=$state -> restarting" >> "$LOG"
pgrep -xq Tailscale || open -g -a Tailscale
sleep 15
"$TS" up ${TS_UP_FLAGS:-} >> "$LOG" 2>&1
echo "$(date '+%F %T') after: $("$TS" status --json 2>/dev/null | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("BackendState"))' 2>&1)" >> "$LOG"
