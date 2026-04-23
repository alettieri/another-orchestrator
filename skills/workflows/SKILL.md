---
description: Author and register custom YAML workflows for the orchestrator
---

# Workflow Authoring Skill

This skill teaches you how to create and register custom YAML workflows for the Agent Orchestrator.

## Overview

Workflows are YAML files that define a directed graph of phases. The runner walks this graph deterministically — it never makes judgment calls. Every transition is explicit in the YAML.

The runner discovers workflows automatically by scanning `*.yaml` files in the workflow directory. The location of this directory is controlled by the `workflowDir` setting in the orchestrator config file (default: the `workflows/` directory bundled with the package). During interactive sessions, the resolved path is available as `$ORCHESTRATOR_WORKFLOW_DIR`. See the **Config Skill** (`skills/config/SKILL.md`) for how the config file is found and how directory paths are resolved.

## Phase Types

### Script

Runs a bash script from the orchestrator's scripts directory (configured via `scriptDir` in the config file, default: bundled `scripts/`). Use for deterministic infrastructure operations that don't need an LLM.

```yaml
- id: setup
  type: script
  command: setup-worktree.sh
  args: ["{{repo}}", "{{branch}}", "{{worktree}}"]
  onSuccess: implement
  onFailure: abort
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique phase identifier. |
| `type` | `"script"` | yes | |
| `command` | string | yes | Script filename in `scripts/` directory. |
| `args` | string[] | no | Arguments passed to the script. Supports `{{variable}}` templates. Defaults to `[]`. |
| `capture` | object | no | Key-value pairs to capture after execution. |
| `onSuccess` | string | yes | Phase ID to transition to on success. |
| `onFailure` | string | yes | Phase ID to transition to on failure. |

### Agent

Invokes a headless coding agent with a rendered prompt template. The agent runs in the ticket's worktree. Prompt templates are loaded from the prompts directory (configured via `promptDir` in the config file). By default, custom templates in `~/.orchestrator/prompts/` are checked first, falling back to bundled defaults. See the **Config Skill** (`skills/config/SKILL.md`) for details.

```yaml
- id: implement
  type: agent
  promptTemplate: implement.md
  allowedTools: ["Read", "Write", "Bash", "Grep", "Glob"]
  maxTurns: 50
  maxRetries: 2
  capture:
    git_diff_stat: "git -C {{worktree}} diff main --stat"
  onSuccess: self_review
  onFailure: retry
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique phase identifier. |
| `type` | `"agent"` | yes | |
| `promptTemplate` | string | yes | Markdown file in `prompts/` directory. Rendered with Nunjucks. |
| `allowedTools` | string[] | no | Tools the agent is allowed to use. |
| `maxTurns` | number | no | Maximum agentic turns for this invocation. |
| `maxRetries` | number | no | How many times the runner retries this phase on failure. Defaults to `0`. |
| `agent` | string \| null | no | Override the agent for this phase. `null` inherits from ticket/plan/global. |
| `capture` | object | no | Key-value pairs to capture after execution. |
| `onSuccess` | string | yes | Phase ID to transition to on success. |
| `onFailure` | string | yes | Phase ID to transition to on failure. Use `"retry"` for automatic retry (respects `maxRetries`). |

### Poll

Repeatedly runs a script at an interval until it succeeds or times out. Use for waiting on external events like PR reviews or merges.

```yaml
- id: await_review
  type: poll
  command: check-pr-review.sh
  args: ["{{repo}}", "{{pr_number}}"]
  intervalSeconds: 120
  timeoutSeconds: 86400
  capture:
    review_state: "stdout"
  onSuccess: handle_review
  onFailure: escalate
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique phase identifier. |
| `type` | `"poll"` | yes | |
| `command` | string | yes | Script filename in `scripts/` directory. |
| `args` | string[] | no | Arguments passed to the script. Supports `{{variable}}` templates. Defaults to `[]`. |
| `intervalSeconds` | number | yes | Seconds between poll attempts. |
| `timeoutSeconds` | number | yes | Maximum seconds before timeout triggers `onFailure`. |
| `capture` | object | no | Key-value pairs to capture after execution. |
| `onSuccess` | string | yes | Phase ID on script exit code 0. |
| `onFailure` | string | yes | Phase ID on timeout. |

### Terminal

Ends the workflow. No further transitions.

```yaml
- id: complete
  type: terminal
  notify: false

- id: escalate
  type: terminal
  notify: true
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique phase identifier. |
| `type` | `"terminal"` | yes | |
| `notify` | boolean | no | If `true`, sets ticket status to `"needs_attention"`. Defaults to `false` (sets `"complete"`). |

## Template Variables

Template variables use `{{variable}}` syntax (Nunjucks) in prompt templates and script arguments.

### Available Variables

All ticket state fields are available:

| Variable | Source |
|----------|--------|
| `{{ticketId}}` | Ticket ID |
| `{{planId}}` | Parent plan ID |
| `{{title}}` | Ticket title |
| `{{description}}` | Full ticket description |
| `{{acceptanceCriteria}}` | Acceptance criteria array |
| `{{repo}}` | Target repo path |
| `{{branch}}` | Git branch name |
| `{{worktree}}` | Worktree path |
| `{{linearUrl}}` | Source ticket URL |
| `{{workflow}}` | Workflow name |

Plus any keys accumulated in the ticket's `context` object by previous phase captures (e.g., `{{pr_url}}`, `{{git_diff_stat}}`, `{{test_output}}`).

## Capture Rules

Any non-terminal phase can define `capture` rules. After the phase executes, the runner runs each capture command and stores the result in the ticket's `context` object.

```yaml
capture:
  pr_url: "gh -C {{worktree}} pr view --json url -q .url"
  pr_number: "gh -C {{worktree}} pr view --json number -q .number"
  test_output: "stdout"
```

- Each key becomes a `context` entry available to all subsequent phases as `{{key}}`.
- Values are shell commands that are executed and their stdout is captured.
- The special value `"stdout"` captures the phase's own stdout instead of running a separate command.

## Prompt Templates

Agent phases reference prompt templates via the `promptTemplate` field. These are Nunjucks markdown files that define what the coding agent sees when it runs a phase.

### How Templates Are Resolved

The runner uses a search path to find templates:

1. **Custom prompts directory** (checked first) — `~/.orchestrator/prompts/` by default, or the `promptDir` setting in config
2. **Bundled prompts** (fallback) — shipped with the package

This means you can override any bundled template by placing a file with the same name in your custom prompts directory. Only the templates you provide are overridden — all others fall back to bundled defaults.

### Bundled Templates

These templates ship with the orchestrator and are used by the `standard` and `bugfix` workflows:

| Template | Used By | Purpose |
|----------|---------|---------|
| `implement.md` | standard | Main implementation prompt — build the feature |
| `implement-bugfix.md` | bugfix | Bug fix variant — reproduce and fix |
| `self-review.md` | standard | Review own changes for correctness and quality |
| `simplify.md` | standard | Clean up and simplify the implementation |
| `verify.md` | bugfix | Run linting, type checking, and tests |
| `create-pr.md` | standard, bugfix | Create a GitHub pull request |
| `handle-review.md` | standard, bugfix | Address PR review feedback and CI failures |

### Creating Custom Templates for New Workflows

When building a custom workflow, you can write your own prompt templates:

1. Create the template file in `~/.orchestrator/prompts/`:
   ```sh
   mkdir -p ~/.orchestrator/prompts
   ```

2. Write a Nunjucks markdown file. Use `{{ variable }}` for template variables:
   ```markdown
   # Security Audit

   Review the code in `{{ worktree }}` for security vulnerabilities.

   ## Ticket
   **{{ ticketId }}**: {{ title }}

   {{ description }}

   {% if acceptance_criteria_list %}
   ## Criteria
   {{ acceptance_criteria_list }}
   {% endif %}
   ```

3. Reference it in your workflow YAML:
   ```yaml
   - id: security_audit
     type: agent
     promptTemplate: security-audit.md
     allowedTools: ["Read", "Grep", "Glob"]
     maxTurns: 30
     onSuccess: complete
     onFailure: abort
   ```

### Overriding Bundled Templates

To customize how the standard workflow implements features without changing the workflow YAML:

```sh
# Copy the bundled template
cp $ORCHESTRATOR_PROMPT_DIR/implement.md ~/.orchestrator/prompts/implement.md
# Edit it
```

The runner will pick up your version automatically on the next run.

### Template Syntax

Templates use [Nunjucks](https://mozilla.github.io/nunjucks/) syntax:

- **Variables**: `{{ ticketId }}`, `{{ description }}`, `{{ pr_url }}`
- **Conditionals**: `{% if linearUrl %}Linear: {{ linearUrl }}{% endif %}`
- **Loops**: `{% for item in acceptanceCriteria %}- {{ item }}\n{% endfor %}`
- **Filters**: `{{ title | upper }}`

Missing variables render as empty strings — they never throw errors. All ticket fields and context variables captured by previous phases are available (see **Template Variables** above).

## Transitions

### Success and Failure

Every non-terminal phase must define `onSuccess` and `onFailure`:

```yaml
onSuccess: next_phase_id
onFailure: error_phase_id
```

### Retry

Set `onFailure: "retry"` along with `maxRetries` to automatically retry a phase:

```yaml
- id: implement
  type: agent
  maxRetries: 2
  onSuccess: verify
  onFailure: retry
```

The runner tracks retries in the ticket's `retries` object. When retries are exhausted, the ticket transitions to `failed`.

### Abort

Use a terminal phase with `notify: true` for hard failures:

```yaml
- id: abort
  type: terminal
  notify: true
```

## Workflow File Structure

```yaml
name: my-workflow
description: A custom workflow for specific use case.
phases:
  - id: setup
    type: script
    command: setup-worktree.sh
    args: ["{{repo}}", "{{branch}}", "{{worktree}}"]
    onSuccess: implement
    onFailure: abort

  - id: implement
    type: agent
    promptTemplate: implement.md
    maxTurns: 50
    maxRetries: 2
    onSuccess: verify
    onFailure: retry

  - id: verify
    type: agent
    promptTemplate: verify.md
    maxTurns: 20
    onSuccess: complete
    onFailure: abort

  - id: complete
    type: terminal
    notify: false

  - id: abort
    type: terminal
    notify: true
```

## How to Add a New Workflow

1. Create a new `.yaml` file in the workflow directory with the workflow definition (include `name`, `description`, `tags`, and `phases`). The workflow directory is `$ORCHESTRATOR_WORKFLOW_DIR` during interactive sessions, or the `workflowDir` path from the config file. To find the current locations, read `$ORCHESTRATOR_CONFIG_PATH` or see the **Config Skill** (`skills/config/SKILL.md`).
2. Create any new prompt templates referenced by agent phases in the prompts directory (`$ORCHESTRATOR_PROMPT_DIR`, or drop them into `~/.orchestrator/prompts/` for automatic pickup).
3. Create any new scripts referenced by script or poll phases in the scripts directory (`$ORCHESTRATOR_SCRIPT_DIR`).
4. Test by creating a plan that uses the new workflow and running `orchestrator run <planId> <ticketId>`.

The workflow is automatically discovered — no separate registration step is needed. The `name` field in the YAML is used as the workflow identifier.

## Common Patterns

### Review Cycle Loop

```yaml
- id: await_review
  type: poll
  command: check-pr-review.sh
  args: ["{{repo}}", "{{pr_number}}"]
  intervalSeconds: 120
  timeoutSeconds: 86400
  onSuccess: await_merge
  onFailure: handle_review

- id: handle_review
  type: agent
  promptTemplate: handle-review.md
  maxTurns: 20
  onSuccess: await_review    # ← loops back after fixing + pushing
  onFailure: escalate
```

### Read-Only Agent Phase

Restrict tools to prevent the agent from modifying files (useful for self-review):

```yaml
- id: self_review
  type: agent
  promptTemplate: self-review.md
  allowedTools: ["Read", "Grep", "Glob"]
  maxTurns: 15
  onSuccess: simplify
  onFailure: implement       # ← back to implement on FAIL
```

### Conditional Retry with Escalation

```yaml
- id: implement
  type: agent
  promptTemplate: implement.md
  maxTurns: 50
  maxRetries: 2
  onSuccess: verify
  onFailure: retry           # retries up to 2 times, then fails

- id: verify
  type: agent
  promptTemplate: verify.md
  maxTurns: 20
  maxRetries: 1
  onSuccess: create_pr
  onFailure: retry
```

### Example: Review-Only Workflow

A minimal workflow that only reviews existing code without making changes:

```yaml
name: review-only
description: Reviews code on an existing branch without making changes.
phases:
  - id: setup
    type: script
    command: setup-worktree.sh
    args: ["{{repo}}", "{{branch}}", "{{worktree}}"]
    onSuccess: review
    onFailure: abort

  - id: review
    type: agent
    promptTemplate: self-review.md
    allowedTools: ["Read", "Grep", "Glob"]
    maxTurns: 20
    capture:
      review_verdict: "stdout"
    onSuccess: cleanup
    onFailure: abort

  - id: cleanup
    type: script
    command: cleanup-worktree.sh
    args: ["{{worktree}}", "{{branch}}"]
    onSuccess: complete
    onFailure: complete

  - id: complete
    type: terminal
    notify: false

  - id: abort
    type: terminal
    notify: true
```

Save this in the workflow directory (e.g., `$ORCHESTRATOR_WORKFLOW_DIR/review-only.yaml`) — it will be automatically discovered by the runner.
