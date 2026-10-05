#!/usr/bin/env python3
"""Check `supabase migration list` output (stdin) for local/remote drift.

  --adopted V...        these versions must be present both locally and remotely
  --allow-local-only    pending local-only migrations are expected (pre-push);
                        without it every row must match (post-push)
A migration that exists only on the remote is always an error.
"""
import re
import sys

args = sys.argv[1:]
allow_local_only = "--allow-local-only" in args
adopted = [a for a in args if re.fullmatch(r"\d+", a)]

rows = {}
for raw in sys.stdin:
    cols = [c.strip() for c in raw.split("|")]
    if len(cols) >= 2 and (re.fullmatch(r"\d+", cols[0]) or re.fullmatch(r"\d+", cols[1])):
        rows[cols[0] or cols[1]] = (cols[0], cols[1])

problems = []
if not rows:
    problems.append("no migrations found in `supabase migration list` output")
for version, (local, remote) in sorted(rows.items()):
    if remote and not local:
        problems.append(f"{version}: applied on remote but missing locally")
    elif local and not remote and not allow_local_only:
        problems.append(f"{version}: present locally but not applied on remote")
for v in adopted:
    local, remote = rows.get(v, ("", ""))
    if not (local and remote):
        problems.append(f"{v}: expected on both local and remote (local={bool(local)}, remote={bool(remote)})")

if problems:
    for p in problems:
        print(f"::error::Migration mismatch: {p}")
    sys.exit(1)
print(f"Migration history OK ({len(rows)} migrations).")
