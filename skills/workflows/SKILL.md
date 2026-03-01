# Workflow Authoring Skill

This skill teaches you how to create and register custom YAML workflows for the Agent Orchestrator.

## Overview

Workflows are YAML files that define a directed graph of phases. The runner walks this graph deterministically — it never makes judgment calls. Every transition is explicit in the YAML.

Workflow files live in `workflows/` and are registered in `workflows/registry.yaml`.

## Phase Types

### Script

Runs a bash script from the orchestrator's `scripts/` directory. Use for deterministic infrastructure operations that don't need an LLM.

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

Invokes a headless coding agent with a rendered prompt template. The agent runs in the ticket's worktree.

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

## Registry

Register your workflow in `workflows/registry.yaml`:

```yaml
- name: my-workflow
  file: my-workflow.yaml
  description: >
    A custom workflow for specific use case. Describe what it does
    so the planner can choose it appropriately.
  tags: [custom, feature]
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Must match the `name` field in the workflow YAML. |
| `file` | string | Filename relative to `workflows/`. |
| `description` | string | Detailed description for the planner to read when selecting workflows. |
| `tags` | string[] | Categorization tags. Common: `feature`, `bug`, `hotfix`, `default`, `review-only`. |

## How to Add a New Workflow

1. Create `workflows/<name>.yaml` with the workflow definition.
2. Add an entry to `workflows/registry.yaml`.
3. Create any new prompt templates referenced by agent phases in `prompts/`.
4. Create any new scripts referenced by script or poll phases in `scripts/`.
5. Test by creating a plan that uses the new workflow and running `orchestrator run <planId> <ticketId>`.

## Common Patterns

### Review Cycle Loop

```yaml
- id: await_review
  type: poll
  command: check-pr-review.sh
  args: ["{{repo}}", "{{pr_number}}"]
  intervalSeconds: 120
  timeoutSeconds: 86400
  onSuccess: handle_review
  onFailure: escalate

- id: handle_review
  type: agent
  promptTemplate: handle-review.md
  maxTurns: 30
  onSuccess: push_fixes
  onFailure: escalate

- id: push_fixes
  type: agent
  promptTemplate: push-fixes.md
  maxTurns: 10
  onSuccess: await_review    # ← loops back
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
    args: ["{{worktree}}"]
    onSuccess: complete
    onFailure: complete

  - id: complete
    type: terminal
    notify: false

  - id: abort
    type: terminal
    notify: true
```

Register it:

```yaml
- name: review-only
  file: review-only.yaml
  description: >
    Reviews code on an existing branch without making changes.
    Read-only agent phase that produces a review verdict.
  tags: [review, read-only]
```
