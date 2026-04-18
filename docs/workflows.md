# Workflows

Workflows define the phase graph that tickets are executed through. Each workflow is a YAML file listing an ordered set of phases with transitions.

## Available Workflows

| Name | File | Description |
|------|------|-------------|
| `minimal` | `minimal.yaml` | Single script phase for testing |
| `standard` | `standard.yaml` | Full implementation flow with self-review, simplify, PR review cycles, and merge |
| `bugfix` | `bugfix.yaml` | Streamlined bug fix flow — skips self-review and simplify, uses minimal-change prompt |
| `manual-pr` | `manual-pr.yaml` | Like standard, but waits for you to open the PR manually before running the review cycle |

## Phase Types

### `script`

Runs a bash script from the configured `scriptDir`.

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Script filename (required) |
| `args` | string[] | Template-interpolated arguments |
| `timeoutSeconds` | number | Max execution time |
| `maxRetries` | number | Retry count on failure (default: 0) |
| `capture` | object | Values to capture from output |
| `onSuccess` | string | Next phase on exit code 0 |
| `onFailure` | string | Next phase on non-zero exit |

### `agent`

Invokes an AI agent with a rendered prompt template.

| Field | Type | Description |
|-------|------|-------------|
| `promptTemplate` | string | Nunjucks template filename (required) |
| `allowedTools` | string[] | Restrict agent tool access |
| `maxTurns` | number | Max agent interaction turns |
| `agent` | string | Override the default agent |
| `maxRetries` | number | Retry count on failure (default: 0) |
| `capture` | object | Values to capture from output |
| `onSuccess` | string | Next phase on agent success |
| `onFailure` | string | Next phase on agent failure |

### `poll`

Repeatedly executes a script at intervals until a condition is met.

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Script filename (required) |
| `args` | string[] | Template-interpolated arguments |
| `intervalSeconds` | number | Seconds between polls (default: `config.pollInterval`) |
| `timeoutSeconds` | number | Max total wait time (default: 86400) |
| `capture` | object | Values to capture on success |
| `onSuccess` | string | Next phase on exit code 0 |
| `onFailure` | string | Next phase on timeout or exit code >= 2 |

**Poll exit code conventions:**

| Exit Code | Meaning | Behavior |
|-----------|---------|----------|
| `0` | Condition met (success) | Stop polling, follow `onSuccess` |
| `1` | Not ready (retry) | Sleep `intervalSeconds`, poll again |
| `>= 2` | Hard error | Stop polling immediately, follow `onFailure` |

### `terminal`

Marks the end of a workflow path. Always succeeds with no output and `null` nextPhase.

| Field | Type | Description |
|-------|------|-------------|
| `notify` | boolean | Send notification on reaching this phase (default: false) |

## Template Variables

All template strings (prompt templates and phase `args`) have access to these variables:

| Variable | Source | Description |
|----------|--------|-------------|
| `ticketId` | Ticket | The ticket identifier |
| `title` | Ticket | Ticket title |
| `description` | Ticket | Full ticket description |
| `repo` | Ticket | Repository name |
| `branch` | Ticket | Git branch name |
| `worktree` | Ticket/Captured | Path to the git worktree |
| `agent` | Ticket | Agent name |
| `linearUrl` | Ticket | Linear issue URL (if available) |
| `acceptance_criteria_list` | Computed | Formatted acceptance criteria |
| `context.*` | Captured | Values captured by previous phases (e.g., `context.pr_url`) |

## Capture Rules

The `capture` field maps keys to capture sources:

- `stdout` — captures the phase's stdout output
- Any other string — executed as a shell command; stdout is captured

Example:
```yaml
capture:
  worktree: stdout
  pr_number: "gh pr view --json number --jq .number"
```

## Scripts

| Script | Arguments | Description |
|--------|-----------|-------------|
| `setup.sh` | repo, branch, worktree | Creates git worktree for the branch |
| `cleanup.sh` | worktree | Removes the git worktree |
| `check-pr-review.sh` | repo_path, pr_number | Checks PR review status (approved/changes_requested) |
| `check-pr-merged.sh` | repo_path, pr_number | Checks if PR is merged/closed |
| `route-review.sh` | review_state | Routes based on review decision (approved→0, else→1) |

## Prompt Templates

| Template | Used By | Description |
|----------|---------|-------------|
| `implement.md` | Standard implement phase | Full feature implementation |
| `implement-bugfix.md` | Bugfix implement phase | Root-cause-first minimal fix |
| `self-review.md` | Self-review phase | Read-only diff review, outputs PASS/FAIL |
| `simplify.md` | Simplify phase | Code cleanup, no behavior changes |
| `verify.md` | Verify phases | Run lint, typecheck, tests; fix failures |
| `create-pr.md` | Create PR phase | Push branch, create PR via `gh` |
| `handle-review.md` | Handle review phase | Address reviewer comments, commit and push fixes |

## Adding a Custom Workflow

1. Create a new YAML file in `workflows/` (e.g., `my-workflow.yaml`).
2. Define the phase graph with `name`, `description`, and `phases` array.
3. Each phase needs at minimum: `id`, `type`, and transitions (`onSuccess`/`onFailure`).
4. End all paths with `terminal` phases.
5. Create any new scripts in `scripts/` and prompt templates in `prompts/` as needed.

The workflow is automatically discovered from the YAML file — no separate registration is needed. Include `name`, `description`, and `tags` fields in the workflow YAML for discoverability.
7. Assign the workflow to tickets by setting `workflow: my-workflow` in the ticket state.
