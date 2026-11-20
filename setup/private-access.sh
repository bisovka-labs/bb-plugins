#!/bin/sh
# Private access to bb over your own tailnet, without bb connect.
#
#   setup/private-access.sh             install or update
#   setup/private-access.sh --dictation also open the phone-dictation route on :18080
#   setup/private-access.sh --check     print the state, change nothing
#   setup/private-access.sh --undo      remove everything this script added
#
# What it builds on the Mac that runs the bb server:
#   tailnet https :17443 -> Caddy 127.0.0.1:38921 -> bb (port from ~/.bb/bb-app-runtime.json)
#   Caddy lets a request through only when `tailscale serve` stamped it with YOUR
#   login (Tailscale-User-Login). Serve strips that header from clients and never
#   sets it for tagged nodes, so servers in the tailnet and shared users get 403.
# Plus: a watchdog that brings Tailscale back up every 2 minutes, and `ts-share`.
set -eu

PREFIX=local.bb-guard
CONF="$HOME/.config/bb-guard"
LOGS="$HOME/Library/Logs/bb-guard"
AGENTS="$HOME/Library/LaunchAgents"
BIN="$HOME/.local/bin"
HERE=$(cd "$(dirname "$0")" && pwd)
APP_PORT=17443
GATE=38921
DICT_PORT=18080
DICT_GATE=38920

TS=${TAILSCALE_BIN:-/Applications/Tailscale.app/Contents/MacOS/Tailscale}
[ -x "$TS" ] || TS=$(command -v tailscale || true)
die() { echo "error: $*" >&2; exit 1; }

bb_port() {
  /usr/bin/python3 - <<'PY' 2>/dev/null || echo 38886
import json, os, urllib.parse
p = os.path.expanduser("~/.bb/bb-app-runtime.json")
print(urllib.parse.urlparse(json.load(open(p))["serverUrl"]).port)
PY
}

ts_json() { "$TS" status --json 2>/dev/null; }
ts_field() { ts_json | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

check() {
  echo "bb server:   127.0.0.1:$(bb_port)"
  if [ -z "$TS" ]; then echo "tailscale:   not installed"; return; fi
  echo "tailscale:   $(ts_field 'print(d.get("BackendState"))')"
  echo "login:       $(ts_field 'print(d["User"][str(d["Self"]["UserID"])]["LoginName"])' 2>/dev/null || echo '?')"
  echo "this Mac:    https://$(ts_field 'print(d["Self"]["DNSName"].rstrip("."))' 2>/dev/null):$APP_PORT"
  echo "caddy:       $(launchctl print "gui/$(id -u)/$PREFIX" >/dev/null 2>&1 && echo running || echo 'not loaded')"
  echo "watchdog:    $(launchctl print "gui/$(id -u)/$PREFIX.tailscale-watchdog" >/dev/null 2>&1 && echo loaded || echo 'not loaded')"
  echo "serve:"; "$TS" serve status 2>/dev/null | sed 's/^/  /' || true
}

undo() {
  "$TS" serve --https=$APP_PORT off 2>/dev/null || true
  "$TS" serve --tcp=$DICT_PORT off 2>/dev/null || true
  for l in "$PREFIX" "$PREFIX.tailscale-watchdog"; do
    launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
    rm -f "$AGENTS/$l.plist"
  done
  rm -f "$BIN/ts-share"
  echo "removed: serve :$APP_PORT/:$DICT_PORT, LaunchAgents, ts-share. Left in place: $CONF, $LOGS"
}

DICT=
case "${1:-}" in
  --check) check; exit 0;;
  --undo) undo; exit 0;;
  --dictation) DICT=1;;
  '') ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2;;
esac

[ -n "$TS" ] || die "install Tailscale first (https://tailscale.com/download/mac) and sign in"
[ "$(ts_field 'print(d.get("BackendState"))')" = Running ] || die "Tailscale is not Running: open the app and sign in"
CADDY=$(command -v caddy || true)
[ -n "$CADDY" ] || die "install Caddy first: brew install caddy"
LOGIN=${BB_GUARD_LOGIN:-$(ts_field 'print(d["User"][str(d["Self"]["UserID"])]["LoginName"])')}
case "$LOGIN" in *@*) ;; *) die "could not read your Tailscale login; set BB_GUARD_LOGIN=you@example.com";; esac
BB=$(bb_port)
HOST=$(ts_field 'print(d["Self"]["DNSName"].rstrip("."))')

mkdir -p "$CONF/data" "$LOGS" "$AGENTS" "$BIN"

# Caddyfile: one gate for the app, and optionally one for the phone-dictation route.
{
  cat <<EOF
# bb-guard: private gates in front of the bb server. Undo: setup/private-access.sh --undo
{
	admin off
	auto_https off
	persist_config off
}

# tailnet :$APP_PORT (tailscale serve https) -> here. Only the owner's identity passes.
http://:$GATE {
	bind 127.0.0.1
	log {
		output file $LOGS/app-gate.log {
			roll_size 20MiB
			roll_keep 5
		}
	}
	@owner header Tailscale-User-Login $LOGIN
	handle @owner {
		reverse_proxy 127.0.0.1:$BB {
			flush_interval -1
		}
	}
	handle {
		respond "forbidden" 403
	}
}
EOF
  if [ -n "$DICT" ]; then cat <<EOF

# tailnet :$DICT_PORT (raw TCP) -> here. Only the token-protected phone-dictation route passes.
http://:$DICT_GATE {
	bind 127.0.0.1
	log {
		output file $LOGS/dictation-gate.log {
			roll_size 20MiB
			roll_keep 5
		}
	}
	@allowed {
		path_regexp ^/api/v1/plugins/phone-dictation/http/new\$
		not path */..* *%2e* *%2f* *%5c*
	}
	handle @allowed {
		reverse_proxy 127.0.0.1:$BB {
			flush_interval -1
		}
	}
	handle {
		respond "forbidden" 403
	}
}
EOF
  fi
} > "$CONF/Caddyfile"
"$CADDY" validate --config "$CONF/Caddyfile" --adapter caddyfile >/dev/null 2>&1 || die "Caddyfile did not validate: $CONF/Caddyfile"

cp "$HERE/tailscale-watchdog.sh" "$CONF/tailscale-watchdog.sh"
cp "$HERE/ts-share" "$BIN/ts-share"
chmod +x "$CONF/tailscale-watchdog.sh" "$BIN/ts-share"

# LaunchAgents read nothing from ~/Documents (macOS privacy), so every path lives in ~/.config.
cat > "$AGENTS/$PREFIX.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$PREFIX</string>
	<key>ProgramArguments</key>
	<array>
		<string>$CADDY</string><string>run</string>
		<string>--config</string><string>$CONF/Caddyfile</string>
		<string>--adapter</string><string>caddyfile</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>HOME</key><string>$HOME</string>
		<key>XDG_DATA_HOME</key><string>$CONF/data</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>$LOGS/caddy.log</string>
	<key>StandardErrorPath</key><string>$LOGS/caddy.log</string>
</dict>
</plist>
EOF
cat > "$AGENTS/$PREFIX.tailscale-watchdog.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$PREFIX.tailscale-watchdog</string>
	<key>ProgramArguments</key>
	<array><string>/bin/sh</string><string>$CONF/tailscale-watchdog.sh</string></array>
	<key>StartInterval</key><integer>120</integer>
	<key>RunAtLoad</key><true/>
</dict>
</plist>
EOF

for l in "$PREFIX" "$PREFIX.tailscale-watchdog"; do
  launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$l.plist"
done
sleep 2

# Point the tailnet at the gate, never at bb directly.
"$TS" serve --bg --https=$APP_PORT "http://127.0.0.1:$GATE" >/dev/null
[ -n "$DICT" ] && "$TS" serve --bg --tcp=$DICT_PORT "tcp://127.0.0.1:$DICT_GATE" >/dev/null

code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "https://$HOST:$APP_PORT/" || true)
echo "bb for your devices: https://$HOST:$APP_PORT  (check from this Mac: HTTP $code, expect 200)"
echo "allowed login:       $LOGIN"
echo "undo:                setup/private-access.sh --undo"
