# Agent Orchestrator — Product Requirements Document

## 1. Overview

### What Is This

A lightweight, two-part system for autonomous software development across multiple project repos. An LLM planner organizes work from project management tools (Linear, GitHub Issues, or others), and a deterministic state machine executes that work by dispatching headless coding agents through YAML-defined workflows.

### Design Principles

- **Separation of thinking and doing.** The LLM reasons about what to do. The state machine does it. They communicate only through files on disk.
- **Deterministic execution.** The state machine never makes judgment calls. Every transition is defined in workflow YAML. If a phase fails, the YAML says what happens next.
- **Agent-agnostic.** The coding agent is configurable — Claude Code or OpenAI Codex, selectable globally, per-plan, per-ticket, or per-workflow-phase.
- **Project-tool-agnostic.** The runner doesn't know about Linear or GitHub Issues. The planner layer handles that abstraction. The ticket state JSON is the universal contract.
- **Repo-agnostic.** The orchestrator lives in its own repo and operates on any target project. Target projects only need their own CLAUDE.md or AGENTS.md for the coding agents to understand how to build, test, and lint.
- **Lightweight.** No databases, no message queues, no frameworks. The state machine is a single TypeScript CLI. State is JSON files on disk. Workflows are YAML. Prompts are markdown templates.
- **Primitives-first.** Behavior is defined through Agent Skills, CLAUDE.md, AGENTS.md, and workflow YAML rather than procedural application code wherever possible.

---

## 2. Architecture

### Two-Process Design

```
┌─────────────────────────────────────────────────────────────┐
│  LLM Planner (interactive Claude Code or Codex session)     │
│                                                             │
│  Human chats → planner fetches tickets → reasons about      │
│  dependencies → writes plan + ticket state JSON files       │
└──────────────────────┬──────────────────────────────────────┘
                       │ writes JSON files
                       ▼
              ┌──── state/ ────┐
              │ plan-a/        │
              │   _plan.json   │
              │   TICKET-1.json│
              │ plan-b/        │
              │   _plan.json   │
              │   TICKET-2.json│
              └───────┬────────┘
                      │ reads / updates
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  State Machine (TypeScript CLI — daemon or one-shot)        │
│                                                             │
│  Scans state directories → picks up ready tickets →         │
│  reads workflow YAML → executes phases in order:            │
│    script phases  → run bash from orchestrator repo         │
│    agent phases   → invoke headless coding agent            │
│    poll phases    → wait for external events (PR reviews)   │
│    terminal       → end workflow                            │
│  Updates state JSON after each phase transition             │
└──────────────────────┬──────────────────────────────────────┘
                       │ spawns per-phase
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Headless Coding Agent Invocations                          │
│                                                             │
│  claude -p "<prompt>" --cwd /worktrees/TICKET-1             │
│    OR                                                       │
│  codex exec "<prompt>" --cwd /worktrees/TICKET-1            │
│                                                             │
│  Each invocation is short-lived and scoped to one phase.    │
│  Agents read the TARGET PROJECT's CLAUDE.md / AGENTS.md     │
│  for repo-specific knowledge (test commands, conventions).  │
└─────────────────────────────────────────────────────────────┘
```

### Process Boundaries

| Concern | LLM Planner | State Machine |
|---------|-------------|---------------|
| Runtime | Interactive session (human at keyboard) | Long-running daemon or one-shot CLI |
| Intelligence | Reasons, plans, prioritizes | Zero — follows YAML transitions |
| Input | Human conversation + project management MCP/API | State files on disk |
| Output | Plan + ticket state JSON files | Updated state files + agent invocations |
| Lifecycle | On-demand, conversational | Persistent background process |
| Error handling | Human decides | Defined in workflow YAML (retry, escalate, abort) |
| Concurrency | Single-threaded chat | Async — multiple tickets in parallel across plans |

### The Contract

The only interface between the planner and the state machine is the `state/` directory. The planner writes JSON files. The runner reads and updates them. They never call each other directly. They don't need to run at the same time.

---

## 3. Multi-Plan State Management

### Directory Layout

```
state/
├── sprint-12-backend/           ← plan directory (plan ID as slug)
│   ├── _plan.json               ← plan metadata, ticket list, dependencies
│   ├── PROJ-101.json            ← ticket state
│   ├── PROJ-102.json
│   └── PROJ-103.json
├── hotfix-auth/                 ← another plan, potentially different repo
│   ├── _plan.json
│   └── PROJ-200.json
└── mobile-sprint-4/             ← can target a completely different repo and agent
    ├── _plan.json
    ├── MOB-50.json
    └── MOB-51.json
```

Plans are isolated by directory. Ticket IDs only need to be unique within their plan. The daemon iterates all plan directories on each tick and respects a global concurrency limit across all plans.

### Plan File (`_plan.json`)

```json
{
  "id": "sprint-12-backend",
  "name": "Sprint 12 — Backend Team",
  "createdAt": "2026-02-28T10:00:00Z",
  "createdBy": "planner",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "standard",
  "agent": "claude",
  "worktreeRoot": "/Users/sam/worktrees",
  "status": "active",
  "tickets": [
    { "ticketId": "PROJ-101", "order": 1, "blockedBy": [] },
    { "ticketId": "PROJ-102", "order": 2, "blockedBy": ["PROJ-101"] },
    { "ticketId": "PROJ-103", "order": 1, "blockedBy": [] }
  ]
}
```

The plan carries defaults that all its tickets inherit: repo, workflow, agent, worktree root. Individual tickets can override any of these.

The `status` field controls whether the daemon processes this plan: `active` plans are scanned each tick, `paused` plans are skipped, `complete` plans are archived.

### Ticket State File (`PROJ-101.json`)

```json
{
  "planId": "sprint-12-backend",
  "ticketId": "PROJ-101",
  "title": "Add password reset endpoint",
  "description": "Implement POST /api/v1/auth/reset-password...",
  "acceptanceCriteria": [
    "Sends reset email with tokenized link",
    "Token expires after 24 hours",
    "Rate limited to 3 requests per hour"
  ],
  "linearUrl": "https://linear.app/mindbloom/issue/PROJ-101",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "standard",
  "branch": "sam/proj-101-password-reset",
  "worktree": "/Users/sam/worktrees/PROJ-101",
  "agent": null,
  "status": "ready",
  "currentPhase": "setup",
  "phaseHistory": [],
  "context": {},
  "retries": {},
  "error": null
}
```

The planner populates everything above `status`. The state machine owns everything from `status` down.

The `context` object accumulates captured values as the ticket moves through phases (git diffs, PR URLs, test output, review notes). Each phase can capture values that subsequent phases reference in their prompt templates.

### Dependency Resolution

Dependencies are defined in the plan's ticket list via `blockedBy` arrays. On each tick, the daemon checks whether all blockers for queued tickets have reached `complete` status. If so, it transitions them to `ready`.

Dependencies are scoped within a plan. Cross-plan dependencies are not supported — if two plans need to coordinate, the human manages that through the planner.

---

## 4. Configurable Coding Agent

### Priority Chain

The agent provider is resolved with a four-level priority chain:

1. **Phase-level** — A workflow phase can specify `agent: codex` to override for that specific phase.
2. **Ticket-level** — A ticket state file can specify `agent: claude` to override for all phases of that ticket.
3. **Plan-level** — A plan can specify `agent: codex` as the default for all tickets in the plan.
4. **Global default** — The `orchestrator.yaml` config specifies the fallback (default: `claude`).

This enables patterns like using Claude for implementation phases and Codex for review, or using different agents for different repos, or switching globally between providers.

### Agent Configuration

```yaml
# orchestrator.yaml
defaultAgent: claude

agents:
  claude:
    command: claude
    defaultArgs:
      - "--dangerously-skip-permissions"
  codex:
    command: codex
    defaultArgs:
      - "--approval-mode"
      - "never"
```

Each agent invocation is a subprocess call: the state machine builds the CLI arguments, sets the working directory to the ticket's worktree, and captures stdout. The agent abstraction layer translates the common interface (prompt, allowed tools, max turns, cwd) into the provider-specific CLI flags.

---

## 5. Workflow System

### Overview

Workflows are YAML files that define a directed graph of phases. Each phase has a type (`script`, `agent`, `poll`, or `terminal`), success/failure transitions, and type-specific configuration. The state machine walks this graph deterministically.

### Workflow Registry

A `workflows/registry.yaml` file lists all available workflows with descriptions and tags. The LLM planner reads this to choose the right workflow for each ticket.

```yaml
- name: standard
  file: standard.yaml
  description: >
    Full implementation workflow: setup → implement → self-review → simplify →
    verify → create PR → review cycle → merge → cleanup.
  tags: [feature, default]

- name: bugfix
  file: bugfix.yaml
  description: >
    Abbreviated workflow for bug fixes. Skips self-review and simplify.
  tags: [bug, hotfix]
```

Users define custom workflows by creating a YAML file in `workflows/` and adding an entry to the registry. The planner skill includes instructions for authoring workflows, and `docs/workflows.md` documents the full phase type reference.

### Phase Types

**Script phases** run bash scripts from the orchestrator's `scripts/` directory. These handle deterministic infrastructure operations that don't need an LLM: creating git worktrees, checking PR state via `gh`, cleaning up branches.

```yaml
- id: setup
  type: script
  command: setup-worktree.sh
  args: ["{{repo}}", "{{branch}}", "{{worktree}}"]
  onSuccess: implement
  onFailure: abort
```

**Agent phases** invoke a headless coding agent with a rendered prompt template. The agent runs in the ticket's worktree where it has access to the target project's CLAUDE.md/AGENTS.md for repo-specific knowledge. The orchestrator does not know how to run tests or lint — the agent figures that out from the project's own docs.

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

**Poll phases** repeatedly run a script at an interval until it succeeds or times out. Used for waiting on external events like PR reviews or merges.

```yaml
- id: await_review
  type: poll
  command: check-pr-review.sh
  args: ["{{repo}}", "{{pr_number}}"]
  intervalSeconds: 120
  timeoutSeconds: 86400
  onSuccess: handle_review
  onFailure: escalate
```

**Terminal phases** end the workflow. They can flag the ticket for human attention or mark it complete.

```yaml
- id: complete
  type: terminal
  notify: false

- id: escalate
  type: terminal
  notify: true    # Sets ticket status to "needs_attention"
```

### Template Variables

Agent prompt templates and script arguments use `{{variable}}` syntax. Variables are populated from the ticket state file fields and the accumulated `context` object. Available variables include all ticket fields (`ticket_id`, `title`, `description`, `acceptance_criteria`, `repo`, `branch`, `worktree`, `linear_url`) plus any keys written to `context` by previous phase captures.

### Capture

Any non-terminal phase can define `capture` rules that extract values after execution and store them in the ticket's `context` for use by later phases:

```yaml
capture:
  pr_url: "gh -C {{worktree}} pr view --json url -q .url"
  test_output: "stdout"    # Special value: captures the phase's own stdout
```

---

## 6. Standard Workflow

The default `standard` workflow implements the full pipeline:

```
setup → implement → self_review → simplify → verify → create_pr
  → await_review ←→ handle_review → verify_post_review → push_fixes
  → await_merge → cleanup → complete
```

### Phase Details

**Setup** (script): Creates a git worktree branched from main. Deterministic, no LLM needed.

**Implement** (agent): Agent reads the ticket description and acceptance criteria, explores the codebase using the project's CLAUDE.md for guidance, implements the feature, writes tests, and commits.

**Self-review** (agent, read-only): Agent reviews its own diff against a quality checklist — correctness, error handling, security, test coverage, naming, complexity. The agent cannot write files during this phase. Outputs a PASS/FAIL verdict. On FAIL, the ticket returns to the implement phase.

**Simplify** (agent): Agent cleans up the implementation — removes dead code, collapses unnecessary abstractions, simplifies conditionals. Does not change functionality.

**Verify** (agent): Agent runs the project's test suite, linting, and any other verification steps defined in the project's CLAUDE.md. If anything fails, the agent attempts to fix it. This phase deliberately uses the agent (not a script) because only the agent knows the project's specific test commands from reading its CLAUDE.md.

**Create PR** (agent): Agent pushes the branch and opens a PR via `gh`. Captures the PR URL and number for subsequent phases.

**Await review** (poll): Polls the PR for unresolved review threads from AI code reviewers or human reviewers. The poll script uses the `gh` CLI to check review state and distinguishes between "has comments to address" (→ handle_review), "waiting" (→ keep polling), and "approved" (→ await_merge).

**Handle review** (agent): Agent reads all pending review comments via `gh pr view`, addresses each one by modifying code, and commits the fixes.

**Verify post-review** (agent): Re-runs verification after review fixes.

**Push fixes** (agent): Pushes the fix commits. Transitions back to await_review, creating the review cycle loop. The cycle repeats until the PR is approved.

**Await merge** (poll): After approval, polls for the PR to be merged (by a human or auto-merge).

**Cleanup** (script): Removes the git worktree.

**Complete / Escalate** (terminal): Marks the ticket done or flags it for human attention.

### Bugfix Workflow

An abbreviated variant that skips self-review and simplify, since bug fixes should be minimal and targeted. Uses a focused prompt that emphasizes minimal changes and root cause identification. Shares the same PR review cycle.

---

## 7. Division of Responsibilities

### What the orchestrator handles (scripts in orchestrator repo)

These are deterministic infrastructure operations:

- Creating and cleaning up git worktrees
- Checking PR review state via `gh` CLI
- Checking if a PR has been merged
- Any future infra tasks (notifications, cost tracking, etc.)

### What the coding agent handles (via prompts, guided by target project's CLAUDE.md)

These are cognitive tasks that require understanding code:

- Implementing features and bug fixes
- Running tests, linting, and build steps (agent reads CLAUDE.md to know how)
- Reviewing diffs for quality
- Simplifying code
- Creating PRs with meaningful descriptions
- Addressing review comments

The orchestrator never needs to know how to run tests in a Django project vs. a React Native project. The agent reads the project's CLAUDE.md and figures it out.

---

## 8. Project-Tool Agnosticism

The state machine has zero knowledge of any project management tool. The ticket state JSON is the universal format — it doesn't matter whether the data originally came from Linear, GitHub Issues, Jira, or was typed by hand.

The abstraction lives in the **planner layer** via provider-specific Agent Skills:

- `skills/providers/linear/SKILL.md` — Teaches the planner how to fetch tickets from Linear via MCP, map Linear fields to ticket state fields, parse dependencies from issue relations, and extract acceptance criteria from ticket descriptions.
- `skills/providers/github-issues/SKILL.md` — Teaches the planner how to fetch issues via `gh` CLI, map GitHub fields, infer dependencies from issue references, and extract criteria from issue body templates.
- `skills/providers/filesystem/SKILL.md` — Teaches the planner how to read issue Markdown files from `~/.orchestrator/issues/`, map frontmatter fields to ticket state fields, and resolve dependencies from `## Dependencies` sections.

Adding a new provider requires only writing a new provider skill. No changes to the runner, workflows, or prompts.

---

## 9. Orchestrator Repo Documentation

### CLAUDE.md

The orchestrator repo has its own CLAUDE.md with progressive disclosure, serving two audiences:

1. **Coding agents working on the orchestrator itself** — When you point Claude Code at the orchestrator repo and ask it to add a feature, it needs to understand the architecture, conventions, and where things live.
2. **The LLM planner** — When the planner agent runs inside the orchestrator repo, the CLAUDE.md orients it and points to the relevant skills.

The CLAUDE.md provides the high-level overview and then references deeper docs: `docs/workflows.md` for the workflow authoring reference, `skills/planner/SKILL.md` for how to create plans, and `skills/providers/` for tool-specific ticket fetching.

### Agent Skills

The orchestrator includes skills that use progressive disclosure:

- **Planner skill** (`skills/planner/SKILL.md`): The core skill. Teaches the LLM how to write plan and ticket state files, including the JSON schemas, field descriptions, naming conventions, and examples. Documents the full CLI command set for the human to use.
- **Workflows skill** (`skills/workflows/SKILL.md`): How to create and register custom workflows. Phase type reference, template variables, capture rules, and common patterns.
- **Provider skills** (`skills/providers/*/SKILL.md`): One per project management tool. How to fetch tickets, map fields, extract criteria, and resolve dependencies from each tool's data model.

---

## 10. Repo Structure

### Orchestrator Repo

```
agent-orchestrator/
├── src/                         # TypeScript source for the CLI
│   ├── cli.ts                   # Entry point (commander-based)
│   ├── core/
│   │   ├── types.ts             # Zod schemas for all data structures
│   │   ├── config.ts            # Config loader (orchestrator.yaml)
│   │   ├── state.ts             # State file manager (multi-plan)
│   │   ├── workflow.ts          # YAML workflow loader + cache
│   │   ├── template.ts          # Nunjucks prompt renderer
│   │   └── runner.ts            # State machine engine + daemon loop
│   ├── agents/
│   │   └── invoke.ts            # Agent abstraction (Claude / Codex)
│   ├── phases/
│   │   └── executor.ts          # Phase type handlers
│   └── utils/
│       ├── shell.ts             # Subprocess execution
│       └── logger.ts            # Per-ticket file + console logging
│
├── workflows/
│   ├── registry.yaml            # Workflow index for planner discovery
│   ├── standard.yaml            # Default feature workflow
│   ├── bugfix.yaml              # Bug fix workflow
│   └── README.md                # Workflow authoring reference
│
├── prompts/                     # Nunjucks templates for agent phases
│   ├── implement.md
│   ├── implement-bugfix.md
│   ├── self-review.md
│   ├── simplify.md
│   ├── verify.md
│   ├── fix-verify.md
│   ├── create-pr.md
│   ├── handle-review.md
│   └── push-fixes.md
│
├── scripts/                     # Bash scripts for infrastructure phases
│   ├── setup-worktree.sh
│   ├── check-pr-review.sh
│   ├── check-pr-merged.sh
│   └── cleanup-worktree.sh
│
├── skills/                      # Agent Skills (progressive disclosure)
│   ├── planner/
│   │   └── SKILL.md
│   ├── workflows/
│   │   └── SKILL.md
│   └── providers/
│       ├── linear/
│       │   └── SKILL.md
│       ├── github-issues/
│       │   └── SKILL.md
│       └── filesystem/
│           └── SKILL.md
│
├── state/                       # Runtime (gitignored)
├── logs/                        # Per-ticket logs (gitignored)
├── schemas/                     # JSON schemas for validation
│
├── CLAUDE.md                    # Project docs with progressive disclosure
├── orchestrator.yaml            # Runner configuration
├── package.json
└── tsconfig.json
```

### Target Project Repos

Target repos require no orchestrator-specific configuration. They only need their existing CLAUDE.md or AGENTS.md:

```
mindbloom-backend/
├── CLAUDE.md          # Django/DRF conventions, test commands, lint config
└── (normal project files)
```

---

## 11. CLI Commands

The state machine is a TypeScript CLI that runs as either a daemon or individual commands.

```
orchestrator init                          # Scaffold directory structure + config
orchestrator daemon                        # Start long-running daemon
orchestrator daemon --agent codex          # Override default agent
orchestrator daemon --concurrency 5        # Override max concurrent tickets
orchestrator run <planId> <ticketId>       # Run a single ticket (blocks until done)
orchestrator tick                          # One daemon tick, then exit
orchestrator status                        # Show all plans and tickets
orchestrator status --plan <planId>        # Filter to one plan
orchestrator status --json                 # Machine-readable output
orchestrator pause <planId> <ticketId>     # Pause a running ticket
orchestrator resume <planId> <ticketId>    # Resume a paused ticket
orchestrator skip <planId> <ticketId> <phase>  # Jump to a specific phase
orchestrator retry <planId> <ticketId>     # Reset retries, re-run current phase
orchestrator pause-plan <planId>           # Pause all work in a plan
orchestrator resume-plan <planId>          # Resume a paused plan
```

---

## 12. Configuration (`orchestrator.yaml`)

```yaml
# Default coding agent
defaultAgent: claude

# Per-agent CLI settings
agents:
  claude:
    command: claude
    defaultArgs:
      - "--dangerously-skip-permissions"
  codex:
    command: codex
    defaultArgs:
      - "--approval-mode"
      - "never"

# Directory paths (relative to orchestrator repo root)
stateDir: ./state
logDir: ./logs
workflowDir: ./workflows
promptDir: ./prompts
scriptDir: ./scripts

# Daemon behavior
pollInterval: 10        # Seconds between ticks
maxConcurrency: 3       # Max tickets running across all plans

# External tools
ghCommand: gh
```

---

## 13. Intervention Model

All intervention is through file edits or CLI commands. No special tooling required.

- **Pause a ticket**: `orchestrator pause <plan> <ticket>` or edit the JSON and set `"status": "paused"`. The runner skips paused tickets on the next tick.
- **Resume**: `orchestrator resume <plan> <ticket>` or set `"status": "running"`.
- **Skip a phase**: `orchestrator skip <plan> <ticket> <phase>` to jump to any phase.
- **Retry**: `orchestrator retry <plan> <ticket>` to reset the retry counter and re-run the current phase.
- **Take over manually**: Pause the ticket, `cd` into the worktree, do whatever you need, then advance the phase and resume.
- **Check status**: Read state files with `jq`, tail log files, or ask the LLM planner to summarize.

---

## 14. Observability

Three levels of visibility:

1. **State files** — `cat state/<plan>/<ticket>.json | jq .currentPhase` for quick checks. The `phaseHistory` array shows the full execution trace.
2. **Logs** — `tail -f logs/<ticketId>.log` for detailed agent output per ticket. Each phase logs its start, duration, exit code, and output summary.
3. **Planner** — Ask the LLM planner "what's the status of everything?" and it reads the state files and summarizes. Can also identify stuck tickets, suggest retries, or flag issues.

A future enhancement could add a TUI dashboard that watches the state directory and renders a live table.

---

## 15. Dependencies

### State Machine (TypeScript CLI)

- **Runtime**: yaml, nunjucks, commander, chalk, zod, chokidar
- **Dev**: typescript, tsx
- **External CLIs**: `claude` and/or `codex` (authenticated), `git`, `gh`

### LLM Planner

- Claude Code CLI (or Codex CLI) with MCP support
- Provider-specific MCP servers (Linear MCP, or just `gh` for GitHub Issues)

### Total: Zero databases, zero message queues, zero Docker, zero frameworks.

---

## 16. Implementation Phases

### Phase 1: Runner Core (3–5 days)

The TypeScript CLI with the main loop, state file loading, YAML parsing, phase execution for `script` and `agent` types, template rendering. One workflow (`standard.yaml`), the four bash scripts, and all prompt templates. Test with manually-created state files to bypass the planner entirely.

### Phase 2: Planner Skill (1–2 days)

Write the planner SKILL.md with schemas and examples, the CLAUDE.md for the orchestrator repo, and connect the Linear MCP (or GitHub Issues via `gh`). Test: chat with Claude, have it generate state files from real tickets, and confirm the runner picks them up.

### Phase 3: Prompt Engineering (3–5 days)

Iterate on all prompt templates against real tickets from actual project repos. Tune `maxTurns`, `allowedTools`, and capture logic. This is where most of the quality comes from — the runner is straightforward engineering, but the system's output quality depends entirely on how well the prompts guide headless agents.

### Phase 4: Polish (2–3 days)

Error handling edge cases, logging improvements, the bugfix workflow, workflow registry, additional provider skills. Optional: TUI dashboard, tmux pane spawning for visibility.

### Estimated Total: 2–3 weeks to a working v1.

---

## 17. Future Enhancements

- **TUI dashboard**: Live terminal UI showing all plans, tickets, phases, and progress.
- **Webhook-based events**: Replace polling for PR reviews/merges with GitHub webhooks.
- **Cost tracking**: Parse agent CLI output for token usage, track per-ticket and per-plan.
- **Auto-dispatch planner**: LLM planner runs on a schedule, checks for new tickets, auto-generates plans.
- **Additional agent providers**: Gemini CLI, Aider, or any other coding agent with a headless CLI mode.
- **Cross-model review**: Use a different agent provider for the self-review phase to get a genuinely independent perspective.
- **Workflow composition**: Allow workflows to call other workflows as sub-phases, enabling reusable workflow fragments.
