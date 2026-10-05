#!/usr/bin/env bash
# Usage: check-function-jwt.sh <function>...
# Fails if a function's LIVE verify_jwt differs from supabase/config.toml
# (default true when unset). Functions not deployed yet are skipped.
# Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID in the environment.
set -euo pipefail

live_json=$(curl -sS --fail-with-body \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/functions")

status=0
for fn in "$@"; do
  want=$(python3 - "$fn" <<'PY'
import sys, tomllib
cfg = tomllib.load(open("supabase/config.toml", "rb"))
print(str(cfg.get("functions", {}).get(sys.argv[1], {}).get("verify_jwt", True)).lower())
PY
)
  live=$(jq -r --arg s "$fn" '[.[] | select(.slug == $s)][0]
    | if . == null then "absent" elif .verify_jwt == null then "true" else (.verify_jwt | tostring) end' <<<"$live_json")
  if [ "$live" = "absent" ]; then
    echo "$fn: not deployed yet; will use config.toml (verify_jwt=$want)"
  elif [ "$live" != "$want" ]; then
    echo "::error::$fn: live verify_jwt=$live but supabase/config.toml says $want. Refusing to touch authentication; set verify_jwt = $live in supabase/config.toml (or change it deliberately in the dashboard first)."
    status=1
  else
    echo "$fn: verify_jwt=$live matches config.toml"
  fi
done
exit $status
