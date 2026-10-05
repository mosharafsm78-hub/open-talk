#!/usr/bin/env python3
"""Fail if a pending migration contains a destructive statement.

Reads the output of `supabase db push --dry-run` on stdin, finds the migration
files it says would be applied, and scans only those. Flags:
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
    pending = sorted(set(re.findall(r"\b\d{14}_[\w.-]+\.sql\b", sys.stdin.read())))
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
