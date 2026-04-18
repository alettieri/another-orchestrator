#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="$1"
BRANCH="$2"

cd "$REPO_PATH"

# Check if a PR exists for this branch
pr_number=$(gh pr view "$BRANCH" --json number --jq '.number' 2>/dev/null) || {
  # No PR found yet — keep polling
  exit 1
}

echo "$pr_number"
exit 0
