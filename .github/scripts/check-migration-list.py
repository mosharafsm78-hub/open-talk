#!/usr/bin/env python3
"""Check `supabase migration list` output (stdin) for local/remote drift.

  --adopted V...        these versions must be present both locally and remotely
  --allow-local-only    pending local-only migrations are expected (pre-push);
                        without it every row must match (post-push)
  --report FILE         also write a markdown report (versions and names only)
  --no-fail             exit 0 even when drift is found (report-only use);
                        an unreadable list is still an error
  --print-remote        print the remote versions, one per line, and exit
  --print-pending       print the versions that exist locally but are not applied
                        on the remote, one per line, and exit
A migration that exists only on the remote is always an error.
"""
import glob
import os
import re
import sys

MIGRATIONS = os.environ.get("MIGRATIONS_DIR", "supabase/migrations")
args = sys.argv[1:]
allow_local_only = "--allow-local-only" in args
no_fail = "--no-fail" in args
print_remote = "--print-remote" in args
print_pending = "--print-pending" in args
report = args[args.index("--report") + 1] if "--report" in args else None
adopted = [a for a in args if re.fullmatch(r"\d+", a)]


def name_of(version):
    hits = glob.glob(f"{MIGRATIONS}/{version}_*.sql")
    return os.path.basename(hits[0])[len(version) + 1:-4] if hits else None


ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
rows = {}
bordered = False  # table has outer | or box-drawing borders (decided from the header row)
for raw in sys.stdin:
    # Tolerate colour codes and box-drawing separators in the CLI's table.
    # CLI 2.119 also wraps every cell in backticks (an empty cell is "` `").
    cols = [c.strip().strip("`").strip() for c in re.split(r"[|\u2502\u2503]", ANSI.sub("", raw))]
    if "local" in (c.lower() for c in cols) and "remote" in (c.lower() for c in cols):
        bordered = cols[0] == ""
        continue
    if bordered:
        cols = cols[1:-1]
    if len(cols) >= 2 and (re.fullmatch(r"\d+", cols[0]) or re.fullmatch(r"\d+", cols[1])):
        rows[cols[0] or cols[1]] = (cols[0], cols[1])

if not rows:
    print("::error::No migrations found in the `supabase migration list` output; refusing to guess.")
    if report:
        with open(report, "w") as f:
            f.write("**Status: could not read the migration list.**\n")
    sys.exit(1)

if print_remote:
    print("\n".join(sorted(r for l, r in rows.values() if r)))
    sys.exit(0)

if print_pending:
    print("\n".join(sorted(l for l, r in rows.values() if l and not r)))
    sys.exit(0)

remote_only = sorted(v for v, (l, r) in rows.items() if r and not l)
local_only = sorted(v for v, (l, r) in rows.items() if l and not r)

problems = []
if remote_only:
    problems.append(
        f"{len(remote_only)} remote migration version(s) are missing from the repo: "
        + ", ".join(remote_only)
        + ". Add the matching files to supabase/migrations, or reconcile the remote history. Nothing was applied."
    )
if local_only and not allow_local_only:
    problems.append(f"present locally but not applied on remote: {', '.join(local_only)}")
for v in adopted:
    local, remote = rows.get(v, ("", ""))
    if not (local and remote):
        problems.append(f"{v}: expected on both local and remote (local={bool(local)}, remote={bool(remote)})")

if report:
    out = []
    if remote_only:
        out.append(f"**Status: ⚠️ drift — {len(remote_only)} remote migration(s) are missing from the repo.**")
    elif local_only:
        out.append(f"**Status: ℹ️ history consistent; {len(local_only)} migration(s) in the repo are not applied yet.**")
    else:
        out.append("**Status: ✅ local and remote migration history match.**")
    if remote_only:
        out += ["", "### Remote versions missing from the repo"] + [f"- `{v}`" for v in remote_only]
    if local_only:
        out += ["", "### In the repo, not applied remotely"] + [f"- `{v}_{name_of(v)}`" for v in local_only]
    out += ["", "### All migrations", "", "| Version | Name | In repo | Applied remotely |", "|---|---|---|---|"]
    for v in sorted(rows):
        l, r = rows[v]
        out.append(f"| `{v}` | {name_of(v) or '(not in repo)'} | {'yes' if l else 'no'} | {'yes' if r else 'no'} |")
    with open(report, "w") as f:
        f.write("\n".join(out) + "\n")

if problems:
    for p in problems:
        print(f"::error::Migration mismatch: {p}")
    sys.exit(0 if no_fail else 1)
print(f"Migration history OK ({len(rows)} migrations).")
