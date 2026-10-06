#!/usr/bin/env python3
"""Fail if a pending migration contains a destructive statement.

Scans ONLY migrations that are not yet applied on the remote, never the ones
already in the remote history. That set is the union of:
  - versions given as arguments (from `check-migration-list.py --print-pending`,
    i.e. present locally but absent from the remote history), and
  - files named in the `supabase db push --dry-run` output on stdin.
Taking it from the remote history means an unrecognised dry-run format can no
longer make the scan silently skip a pending migration. Flags:
  - any DROP statement
  - TRUNCATE
  - DELETE FROM without a WHERE clause
  - column type changes (ALTER COLUMN ... [SET DATA] TYPE)
Exits 1 (and applies nothing, because this runs before `db push`) on a hit.
"""
import os
import re
import sys
from pathlib import Path

MIGRATIONS = Path(os.environ.get("MIGRATIONS_DIR", "supabase/migrations"))


def strip_comments(sql: str) -> str:
    # Blank comments out but keep newlines so reported line numbers stay right.
    sql = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


def findings(sql: str):
    s = strip_comments(sql)
    line = lambda pos: s.count("\n", 0, pos) + 1
    for m in re.finditer(r"\bdrop\s+\w+", s, re.I):
        yield line(m.start()), "DROP statement"
    for m in re.finditer(r"\btruncate\b", s, re.I):
        yield line(m.start()), "TRUNCATE"
    for m in re.finditer(r"\bdelete\s+from\b", s, re.I):
        end = s.find(";", m.end())
        stmt = s[m.start(): end if end != -1 else len(s)]
        if not re.search(r"\bwhere\b", stmt, re.I):
            yield line(m.start()), "DELETE without WHERE"
    for m in re.finditer(r'\balter\s+column\s+"?\w+"?\s+(?:set\s+data\s+)?type\b', s, re.I):
        yield line(m.start()), "column type change"


def main() -> int:
    pending = set(re.findall(r"\b\d{14}_[\w.-]+\.sql\b", sys.stdin.read()))
    for version in sys.argv[1:]:
        if not re.fullmatch(r"\d{14}", version):
            print(f"::error::Unexpected migration version argument: {version!r}")
            return 1
        hits = sorted(MIGRATIONS.glob(f"{version}_*.sql"))
        if not hits:
            print(f"::error::Pending migration {version} has no file in {MIGRATIONS}")
            return 1
        pending.update(h.name for h in hits)
    pending = sorted(pending)
    if not pending:
        print("No pending migrations; nothing to scan.")
        return 0
    bad = 0
    for name in pending:
        path = MIGRATIONS / name
        if not path.is_file():
            print(f"::error::Pending migration {name} is not in {MIGRATIONS}")
            bad += 1
            continue
        hits = list(findings(path.read_text()))
        for lineno, what in hits:
            print(f"::error file={path},line={lineno}::Destructive migration: {what}")
        bad += len(hits)
        print(f"{'FAIL' if hits else 'ok  '} {name}")
    if bad:
        print(
            "\nBlocked: pending migrations contain destructive statements. "
            "Nothing was applied. Rewrite them to be additive and "
            "backward-compatible (see docs/DEPLOY.md); if a destructive change "
            "is truly intended, apply it by hand after review."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
