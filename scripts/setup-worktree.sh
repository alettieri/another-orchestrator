#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: setup-worktree.sh <repo_path> <branch_name> <worktree_path> <post_setup_hooks_json>" >&2
  exit 1
fi

REPO_PATH="$1"
BRANCH_NAME="$2"
WORKTREE_PATH="$3"
POST_SETUP_HOOKS_JSON="$4"

cd "$REPO_PATH"

git fetch origin

if git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" 2>/dev/null; then
  echo "Created worktree at $WORKTREE_PATH on new branch $BRANCH_NAME"
else
  # Branch may already exist — try without -b
  git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
  echo "Created worktree at $WORKTREE_PATH on existing branch $BRANCH_NAME"
fi

mapfile -t POST_SETUP_HOOKS < <(
  node -e '
    const hooks = JSON.parse(process.argv[1]);
    if (!Array.isArray(hooks)) {
      throw new Error("post-setup hooks must be an array");
    }
    for (const hook of hooks) {
      if (typeof hook !== "string") {
        throw new Error("post-setup hooks must be strings");
      }
      console.log(hook);
    }
  ' "$POST_SETUP_HOOKS_JSON"
)

if [ "${#POST_SETUP_HOOKS[@]}" -eq 0 ]; then
  exit 0
fi

cd "$WORKTREE_PATH"

for hook in "${POST_SETUP_HOOKS[@]}"; do
  echo "Running post-setup hook: $hook"
  if bash -lc "$hook"; then
    echo "Post-setup hook succeeded: $hook"
  else
    exit_code=$?
    echo "Warning: post-setup hook failed with exit code $exit_code: $hook" >&2
  fi
done
