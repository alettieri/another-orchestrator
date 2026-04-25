# Prompt Templates

Nunjucks templates that define what coding agents see when they work on a ticket phase. Each template is referenced by a workflow YAML `promptTemplate` field.

## Custom Prompts

To override any template, place a file with the same name in `~/.orchestrator/prompts/`:

```sh
mkdir -p ~/.orchestrator/prompts
# Copy and edit the template you want to change
cp <bundled>/prompts/implement.md ~/.orchestrator/prompts/implement.md
```

The orchestrator automatically checks `~/.orchestrator/prompts/` first, then falls back to the bundled templates. Only the templates you provide are overridden — all others use the bundled defaults. No config change needed.

To use a different directory instead, set `promptDir` in your config:

```yaml
# ~/.orchestrator/config.yaml
promptDir: ~/my-prompts
```

## Template Variables

All templates receive the full ticket state as template context. Variables are interpolated with `{{ variableName }}` syntax (Nunjucks).

### Ticket Fields

These are always available in every template:

| Variable | Type | Description |
|----------|------|-------------|
| `ticketId` | string | Ticket identifier (e.g., `PROJ-123`) |
| `planId` | string | Parent plan ID |
| `title` | string | Ticket title |
| `description` | string | Full ticket description |
| `repo` | string | Repository name or path |
| `branch` | string | Git branch for this ticket |
| `worktree` | string | Absolute path to the git worktree |
| `workflow` | string | Workflow name (e.g., `standard`) |
| `agent` | string or null | Agent override for this ticket |
| `status` | string | Current ticket status |
| `currentPhase` | string | Current phase ID |
| `linearUrl` | string or empty | Linear issue URL (empty string if null) |
| `acceptanceCriteria` | string[] | Raw array of acceptance criteria |
| `error` | string or null | Last error message |

### Derived Variables

| Variable | Type | Description |
|----------|------|-------------|
| `acceptance_criteria_list` | string | Acceptance criteria formatted as markdown bullet list (`- item`) |

### Context Variables (Captured from Previous Phases)

Workflow phases can capture values from script output. These are stored in the ticket's `context` map and merged into the template as top-level variables.

| Variable | Captured By | Description |
|----------|-------------|-------------|
| `pr_url` | `create_pr` phase | GitHub PR URL |
| `pr_number` | `create_pr` phase | GitHub PR number |
| `self_review_feedback` | `self_review` phase (standard workflow) | Self-review PASS/FAIL output with issues list |
| `review_state` | `await_review` phase (bugfix workflow) | PR review state |

Context variables are workflow-specific. Custom workflows can capture and expose any values they need. Access them with `{{ variable_name }}` (they are promoted to top-level, not nested under `context.`).

### Conditional Blocks

Templates can use Nunjucks conditionals for optional fields:

```nunjucks
{% if acceptance_criteria_list %}
## Acceptance Criteria
{{ acceptance_criteria_list }}
{% endif %}

{% if linearUrl %}
Linear issue: {{ linearUrl }}
{% endif %}
```

Missing variables render as empty strings (never throw errors).

## Template Reference

### `implement.md`

**Used by:** `standard` workflow — `implement` phase

Main implementation prompt. Tells the agent to implement the ticket's feature in the worktree. Includes the ticket description, acceptance criteria, and optional Linear URL.

### `implement-bugfix.md`

**Used by:** `bugfix` workflow — `implement` phase

Bug fix variant of the implementation prompt. Focused on reproducing and fixing the bug.

### `self-review.md`

**Used by:** `standard` workflow — `self_review` phase

Asks the agent to review its own changes. Checklist-style prompt covering correctness, edge cases, and code quality.

### `simplify.md`

**Used by:** `standard` workflow — `simplify` phase

Asks the agent to simplify and clean up the implementation. Focuses on removing unnecessary complexity.

### `verify.md`

**Used by:** `bugfix` workflow — `verify` phase

Asks the agent to run linting, type checking, and tests to verify correctness.

### `create-pr.md`

**Used by:** `standard` and `bugfix` workflows — `create_pr` phase

Asks the agent to create a GitHub PR. Uses `linearUrl` if available. The phase captures `pr_url` and `pr_number` from the result.

### `handle-review.md`

**Used by:** `standard` and `bugfix` workflows — `handle_review` phase

Asks the agent to address PR review feedback and CI failures. Checks review comments and CI status, makes fixes, resolves review threads, runs verification checks, then commits and pushes. Uses `{{ pr_url }}` and `{{ pr_number }}` (captured by the `create_pr` phase).

### `interactive-system.md`

**Used by:** `orchestrator interactive` when the selected agent uses the Claude launcher

System prompt injected into Claude interactive planning sessions. Not a workflow template — this defines the agent's role as the orchestrator's planning agent. Other configured agents receive the shared planning environment without this Claude-specific prompt injection; PI-style agents use the in-process launcher.

## Writing Custom Templates

1. Copy a bundled template to `~/.orchestrator/prompts/`:
   ```sh
   mkdir -p ~/.orchestrator/prompts
   cp <bundled>/prompts/implement.md ~/.orchestrator/prompts/implement.md
   ```

2. Edit the template. Use any of the variables listed above.

3. That's it — the orchestrator will pick it up automatically on the next run.

Templates use [Nunjucks](https://mozilla.github.io/nunjucks/) syntax: `{{ variable }}`, `{% if condition %}`, `{% for item in list %}`, filters like `{{ value | upper }}`, etc.
