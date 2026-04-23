#!/usr/bin/env bash
set -euo pipefail

# Idempotent worktree removal script
# Args: $1=worktree_path, $2=branch_name

if [[ -z "${1:-}" || -z "${2:-}" ]]; then
  echo "Usage: cleanup-worktree.sh <worktree_path> <branch_name>" >&2
  exit 1
fi

WORKTREE_PATH="$1"
BRANCH_NAME="$2"

if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo "Worktree already removed: $WORKTREE_PATH"
  echo "Branch cleanup skipped for $BRANCH_NAME because the repository could not be resolved from the missing worktree."
  exit 0
fi

echo "Cleaning worktree ${WORKTREE_PATH}"

REPO_ROOT="$(git -C "$WORKTREE_PATH" rev-parse --git-common-dir)"
REPO_ROOT="$(cd "$(dirname "$REPO_ROOT")" && pwd)"

git -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" --force
git -C "$REPO_ROOT" worktree prune

echo "Worktree removed: $WORKTREE_PATH"

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  if DELETE_OUTPUT="$(git -C "$REPO_ROOT" branch -d -- "$BRANCH_NAME" 2>&1)"; then
    echo "$DELETE_OUTPUT"
    echo "Branch removed: $BRANCH_NAME"
    exit 0
  fi

  echo "Git refused to delete branch $BRANCH_NAME after worktree cleanup." >&2
  echo "$DELETE_OUTPUT" >&2
  exit 1
fi

echo "Branch already removed: $BRANCH_NAME"
exit 0
