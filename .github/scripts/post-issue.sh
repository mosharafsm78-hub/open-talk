#!/usr/bin/env bash
# Usage: post-issue.sh "<issue title>" <body-file>
# Comments on the open issue with this exact title (created by github-actions),
# or opens it. Needs GH_TOKEN, GH_REPO and `issues: write`.
set -euo pipefail
title=$1
body=$2
number=$(gh issue list --app github-actions --state open --limit 100 --json number,title \
  | jq -r --arg t "$title" '[.[] | select(.title == $t)][0].number // empty')
if [ -n "$number" ]; then
  gh issue comment "$number" --body-file "$body"
else
  gh issue create --title "$title" --body-file "$body"
fi
