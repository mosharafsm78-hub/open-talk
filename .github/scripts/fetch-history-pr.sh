#!/usr/bin/env bash
# Usage: fetch-history-pr.sh <dir with migration files fetched from the remote>
# Copies fetched files whose version has no file in supabase/migrations yet
# (never overwrites or deletes anything), scans them for credential-like
# content, and opens a DRAFT pull request with them. Writes the issue text to
# $RUNNER_TEMP/issue-body.md (file names only). Needs GH_TOKEN and GH_REPO.
set -euo pipefail
shopt -s nullglob
src=$1
body_out="${RUNNER_TEMP:?}/issue-body.md"
branch=automation/fetch-remote-migrations

new=()
for f in "$src"/*.sql; do
  base=$(basename "$f")
  [[ $base =~ ^([0-9]+)_[A-Za-z0-9_.-]*\.sql$ ]] || { echo "::error::Unexpected file name in fetched history"; exit 1; }
  existing=(supabase/migrations/${BASH_REMATCH[1]}_*.sql)
  if [ ${#existing[@]} -gt 0 ]; then echo "Already in the repo: ${BASH_REMATCH[1]}"; continue; fi
  new+=("$base")
done

if [ ${#new[@]} -eq 0 ]; then
  echo "✅ Nothing to add: every migration in the remote history already has a file in the repo." > "$body_out"
  exit 0
fi

mkdir -p supabase/migrations
for b in "${new[@]}"; do cp "$src/$b" "supabase/migrations/$b"; done

# This repo is public and the branch is visible as soon as it is pushed, so
# refuse to publish anything that looks like a credential. Names only are shown.
blocked=(); data=()
for b in "${new[@]}"; do
  p=supabase/migrations/$b
  if grep -Eq 'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}|postgres(ql)?://[^[:space:]:@/]+:[^[:space:]@]+@' "$p"; then
    blocked+=("$b")
  elif grep -Eqi '^[[:space:]]*(insert[[:space:]]+into|copy[[:space:]].*from[[:space:]]+stdin)' "$p"; then
    data+=("$b")
  fi
done
if [ ${#blocked[@]} -gt 0 ]; then
  for b in "${new[@]}"; do rm -f "supabase/migrations/$b"; done
  { echo "⚠️ **Not published.** These fetched migration(s) look like they contain credentials, so nothing was pushed:"
    printf '%s\n' "${blocked[@]/#/- \`}" | sed 's/$/`/'; } > "$body_out"
  echo "::error::Credential-like content found in ${#blocked[@]} fetched migration(s); nothing published."
  exit 1
fi

if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  echo "::error::Branch $branch already exists; this one-time job has already run."
  exit 1
fi
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -q -b "$branch"
git add supabase/migrations
# Only additions: nothing existing may be modified, renamed or deleted.
if [ -n "$(git diff --cached --name-status | grep -v '^A')" ]; then
  echo "::error::Fetched files would change existing files; aborting."; exit 1
fi
git commit -q -m "Add migrations already applied on the remote (fetched read-only)"
git push -q origin "$branch"

list=$(printf '%s\n' "${new[@]}" | sed 's/^/- `/; s/$/`/')
warn=""
if [ ${#data[@]} -gt 0 ]; then
  warn=$'\n\nThese contain INSERT/COPY statements (data): review before merging:\n'$(printf '%s\n' "${data[@]}" | sed 's/^/- `/; s/$/`/')
fi
cat > "$RUNNER_TEMP/pr-body.md" <<EOT
Migrations that are already applied on the remote database but had no file in the repo. Fetched with \`supabase migration fetch --linked\` in a scratch directory (it only reads the migration history table), then copied in as **new files only**; no existing file was changed.

${list}${warn}

**Review the SQL before merging; this repository is public.**

Merging this touches \`supabase/migrations\`, which triggers the deploy workflow: it marks the three \`20261005*\` migrations as applied (\`migration repair --status applied\`), verifies local and remote history match, scans for destructive statements, and runs \`db push\` (nothing should be pending).
EOT
n=${#new[@]}
if url=$(gh pr create --draft --base main --head "$branch" \
    --title "Add $n migrations already applied on the remote" --body-file "$RUNNER_TEMP/pr-body.md"); then
  result="✅ Fetched $n migration file(s) (read-only). Draft PR: $url"
else
  result="✅ Fetched $n migration file(s) (read-only) and pushed branch \`$branch\`, but could not open the PR (enable *Allow GitHub Actions to create and approve pull requests* in Settings → Actions → General). Open it: https://github.com/$GH_REPO/compare/main...$branch?expand=1"
fi
{ echo "$result"; echo; echo "$list"; [ -z "$warn" ] || echo "$warn"; } > "$body_out"
