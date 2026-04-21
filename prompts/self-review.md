# Self-Review Task

## Ticket: {{ ticketId }}

**{{ title }}**

{{ description }}

## Working Directory

You are working in: `{{ worktree }}`
Branch: `{{ branch }}`
Repository: `{{ repo }}`

## Instructions

Review the current diff on this branch. Run `git diff main` (or the appropriate base branch) to see all changes.

Note: In worktrees, `git diff main` may show deletions for files that exist on main but aren't in this worktree 
(e.g., .env.local, *.tfvars). Ignore these — only review changes from this branch's commits. Use `git log main..HEAD--oneline` to identify your commits, then scope your review to those changes only.

Evaluate the diff against this checklist:

1. **Correctness**: Does the code do what the ticket requires? Are there logic errors?
2. **Security**: Are there any injection risks, leaked secrets, or unsafe operations?
3. **Tests**: Are new behaviors covered by tests? Do existing tests still pass?
4. **Edge cases**: Are boundary conditions and error paths handled?
5. **Code style**: Does the code follow the project's conventions?
6. **Dead code**: Is there any unused code, commented-out blocks, or debug statements?
7. **Naming**: Are variables, functions, and files named clearly and consistently?

**This is a read-only review.** Do not modify any files.

After reviewing, output exactly one of:
- `PASS` — if the code is ready for PR
- `FAIL` — followed by a list of issues that need to be addressed
