#!/bin/sh
# Superseded: the dev.bisovka.bb-patches LaunchAgent runs apply-all.sh on every
# bb.app change, and apply-all.sh applies every *.py patch in this folder.
# Kept so older notes still work: forces a re-apply now.
exec /bin/sh "$(dirname "$0")/apply-all.sh" --force
