#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: setup-worktree.sh <repo_path> <branch_name> <worktree_path>" >&2
  exit 1
fi

REPO_PATH="$1"
BRANCH_NAME="$2"
WORKTREE_PATH="$3"

cd "$REPO_PATH"

git fetch origin
git pull

if git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" 2>/dev/null; then
  echo "Created worktree at $WORKTREE_PATH on new branch $BRANCH_NAME"
else
  # Branch may already exist — try without -b
  git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
  echo "Created worktree at $WORKTREE_PATH on existing branch $BRANCH_NAME"
fi
