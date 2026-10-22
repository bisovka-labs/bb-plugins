#!/bin/sh
# Add the Bisovka marketplace to bb and install its plugins from GitHub.
#   scripts/install.sh                  every plugin in the catalog
#   scripts/install.sh todo openui      only these
# bb asks to confirm each install; pass --yes as the first argument to skip that.
set -e
YES=
[ "$1" = "--yes" ] && { YES=--yes; shift; }
REPO=git:https://github.com/bisovka-labs/bb-plugins.git@main
CATALOG=$(cd "$(dirname "$0")/.." && pwd)/.bb/plugins.json

bb marketplace list | grep -q '^bisovka ' || bb marketplace add "$REPO"
bb marketplace refresh bisovka

IDS=${*:-$(python3 -c 'import json,sys; print(" ".join(p["name"] for p in json.load(open(sys.argv[1]))["plugins"]))' "$CATALOG")}
for id in $IDS; do
  bb plugin install "$id@bisovka" $YES || echo "skipped $id"
done
