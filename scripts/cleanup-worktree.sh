#!/usr/bin/env bash
set -euo pipefail

# Idempotent worktree removal script
# Args: $1=worktree_path

if [[ -z "${1:-}" ]]; then
  echo "Usage: cleanup-worktree.sh <worktree_path>" >&2
  exit 1
fi

WORKTREE_PATH="$1"

if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo "Worktree already removed: $WORKTREE_PATH"
  exit 0
fi

REPO_ROOT="$(git -C "$WORKTREE_PATH" rev-parse --git-common-dir)"
REPO_ROOT="$(cd "$(dirname "$REPO_ROOT")" && pwd)"

git -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" --force
git -C "$REPO_ROOT" worktree prune

echo "Worktree removed: $WORKTREE_PATH"
exit 0
