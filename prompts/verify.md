# Verify Task

## Ticket: {{ ticketId }}

**{{ title }}**

## Working Directory

You are working in: `{{ worktree }}`
Branch: `{{ branch }}`
Repository: `{{ repo }}`

## Instructions

Confirm that all checks pass. Run each in order and fix any failures:

1. Run the linter and fix all lint errors.
2. Run the type checker and fix all type errors.
3. Run the full test suite and fix any failing tests.
4. Do not commit your changes — the orchestrator will handle that.

All three checks (lint, typecheck, tests) must pass before this phase is complete.
