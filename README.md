# Another Orchestrator

A lightweight CLI tool for autonomous software development. An LLM planner organizes work from project management tools (Linear, GitHub Issues, or manual input), and a deterministic state machine executes that work by dispatching headless coding agents through YAML-defined workflows.

## How It Works

The orchestrator runs as two separate processes that communicate through JSON files on disk:

1. **Planner** (`orchestrator interactive`) -- launches an interactive PI coding agent session where you describe the work. The agent reasons about tickets, dependencies, and priorities, then writes plan and ticket state files. PI runs from your current directory (e.g., a workspace with multiple repos) and discovers target repos interactively.
2. **Runner** (`orchestrator daemon`) -- a deterministic state machine that reads those state files, walks YAML workflow phase graphs, and dispatches headless coding agents (Claude Code, Codex, or others) as subprocesses in isolated git worktrees.

The `state/plans/` directory is the only interface between the two. The planner writes JSON. The runner reads and updates it. They never call each other directly and don't need to run at the same time. Both commands work from any directory after a global install.

## Prerequisites

- **Node 24** (see `.nvmrc`)
- **pnpm** package manager
- **git**
- **gh** CLI (GitHub CLI, for PR operations)
- A coding agent CLI: **claude** (Claude Code) and/or **codex** (OpenAI Codex)
- The PI coding agent (`@mariozechner/pi-coding-agent`) is installed automatically as a dependency

## Getting Started

### Installation

```sh
git clone <repo-url> && cd another-orchestrator
nvm use
pnpm install
pnpm run build
pnpm link --global
orchestrator init
```

### The Interactive Agent

The primary interface is `orchestrator interactive`. It launches an LLM-powered planning session (PI) where you describe what you want done in natural language. The agent knows how to create plans, manage configuration, explore your workspace, author workflows, and connect to project management tools like Linear or GitHub Issues.

Run it from your workspace directory (the root where your repos live):

```sh
cd ~/workspace
orchestrator interactive
```

The agent writes plan and ticket state files that the execution engine consumes. You don't need to edit JSON by hand -- the agent handles it.

### Running Work

Once you have a plan, start the daemon to process tickets automatically:

```sh
orchestrator daemon
```

The daemon reads state files, walks YAML workflow phases, and dispatches headless coding agents in isolated git worktrees. It runs continuously until stopped with Ctrl+C.

### Checking Status

```sh
orchestrator status                  # overview of all plans
orchestrator status --plan <id>      # detailed view of one plan
```

## CLI Reference

All commands accept `-C, --config <path>` to use a specific config file.

| Command | Description |
|---------|-------------|
| `orchestrator init [--dir <path>]` | Create `~/.orchestrator/` with default config, state, and logs dirs |
| `orchestrator interactive [--repo <path>] [--workflow <name>]` | Launch interactive PI planning session (defaults to CWD) |
| `orchestrator status [--plan <id>] [--json]` | Show plan and ticket status |
| `orchestrator run <planId> <ticketId>` | Run a single ticket through its workflow (blocks until done) |
| `orchestrator daemon [--concurrency <n>] [--agent <name>]` | Start the daemon loop to process tickets continuously |
| `orchestrator tick` | Run a single daemon tick and exit |
| `orchestrator pause <planId> <ticketId>` | Pause a running ticket |
| `orchestrator resume <planId> <ticketId>` | Resume a paused ticket |
| `orchestrator skip <planId> <ticketId> <phase>` | Skip to a specific workflow phase |
| `orchestrator retry <planId> <ticketId>` | Reset retries and re-run the current phase |
| `orchestrator pause-plan <planId>` | Pause an entire plan |
| `orchestrator resume-plan <planId>` | Resume a paused plan |
| `orchestrator sessions <planId> <ticketId> [--phase <phase>] [--json]` | List Claude sessions for a ticket |
| `orchestrator resume-session <planId> <ticketId> [sessionId] [--phase <phase>]` | Resume a Claude session interactively |

## Architecture

### Two-Process Design

```
Planner (interactive)          Runner (daemon)
  Human describes work    -->    Reads state files
  PI agent reasons        -->    Walks YAML workflows
  Writes plan JSON        -->    Dispatches coding agents
         \                          /
          \__ state/plans/ ________/
              (JSON files on disk)
```

The planner is an interactive LLM session (human at the keyboard). The runner is a deterministic state machine that follows YAML transitions with zero judgment calls.

### State Management

Plans are directories under `state/plans/`. Each contains a `plan.json` with metadata and a `tickets/` subdirectory with per-ticket state files.

```
state/plans/
  sprint-12-backend/
    plan.json              # Plan metadata, ticket list, dependencies
    tickets/
      PROJ-101.json        # Ticket execution state
      PROJ-102.json
  hotfix-auth/
    plan.json
    tickets/
      PROJ-200.json
```

The daemon iterates all plan directories on each tick and respects a global concurrency limit across all plans. Dependencies between tickets within a plan are resolved automatically via `blockedBy` arrays.

### Workflows

Workflows are YAML files defining a directed graph of phases. Each phase has a type and explicit success/failure transitions.

**Phase types:**
- **script** -- runs a bash script for deterministic infrastructure operations (worktree setup, PR state checks)
- **agent** -- invokes a headless coding agent with a rendered prompt template
- **poll** -- repeatedly runs a script at an interval until it succeeds or times out (PR review polling)
- **terminal** -- ends the workflow, optionally flagging for human attention

The standard workflow: `setup -> implement -> self_review -> simplify -> verify -> create_pr -> await_review <-> handle_review -> await_merge -> cleanup -> complete`

### Agent Invocation

The coding agent is configurable at four levels (highest priority first):
1. **Phase-level** -- workflow YAML `agent` field
2. **Ticket-level** -- ticket state `agent` field
3. **Plan-level** -- plan `agent` field
4. **Global default** -- `defaultAgent` in config

Each invocation is a subprocess in the ticket's git worktree. The agent reads the target project's own CLAUDE.md/AGENTS.md for repo-specific knowledge (how to test, lint, build).

### Session Tracking

When the orchestrator dispatches a Claude agent phase, it captures the session ID from Claude's JSON output. Session IDs are persisted in each ticket's `phaseHistory` entries and logged to both the console and the log file.

Users can list all Claude sessions for a ticket and resume any session interactively:

```sh
# List all Claude sessions for a ticket
orchestrator sessions <planId> <ticketId>

# Filter sessions by phase
orchestrator sessions <planId> <ticketId> --phase implement

# Resume the most recent session
orchestrator resume-session <planId> <ticketId>

# Resume a specific session
orchestrator resume-session <planId> <ticketId> cc807f8c-1234-5678-abcd-ef0123456789

# Resume the most recent session from a specific phase
orchestrator resume-session <planId> <ticketId> --phase self_review
```

## Project Structure

```
src/
  cli.ts                      # CLI entry point (commander-based)
  core/
    types.ts                  # Zod schemas for all data structures
    config.ts                 # Config loader (~/.orchestrator/config.yaml)
    state.ts                  # State file manager (multi-plan)
    workflow.ts               # YAML workflow loader + cache
    template.ts               # Nunjucks prompt renderer
    runner.ts                 # State machine engine + daemon loop
  agents/
    invoke.ts                 # Agent abstraction (Claude / Codex)
    interactive.ts            # Interactive PI integration (calls library directly)
  phases/
    executor.ts               # Phase type handlers
  utils/
    shell.ts                  # Subprocess execution
    logger.ts                 # Per-ticket file + console logging

workflows/                    # YAML workflow definitions
  standard.yaml               # Default feature workflow
  bugfix.yaml                 # Bug fix workflow
  minimal.yaml                # Single-phase testing workflow

prompts/                      # Nunjucks templates for agent phases
  interactive-system.md       # System prompt for PI interactive sessions
scripts/                      # Bash scripts for infrastructure phases
skills/                       # Agent Skills documentation
  cli/SKILL.md                # CLI command reference for interactive sessions
  config/SKILL.md             # Config file reference for interactive sessions
  planner/SKILL.md            # Plan/ticket JSON schemas + examples
  workflows/SKILL.md          # Workflow authoring guide
  providers/
    linear/SKILL.md           # Linear integration
    github-issues/SKILL.md    # GitHub Issues integration

docs/                         # Reference documentation
  workflows.md                # Workflow authoring reference
  prompts.md                  # Prompt templates, variables, and customization
```

## Configuration

Config is created by `orchestrator init` at `~/.orchestrator/config.yaml`. The resolution order is:

1. `--config <path>` CLI flag (explicit)
2. `$ORCHESTRATOR_HOME/config.yaml` (env var override)
3. `~/.orchestrator/config.yaml` (default)
4. `./orchestrator.yaml` (CWD fallback for local dev)

**Bundled with the package** (resolved automatically from the npm installation):
- `workflows/` -- YAML workflow definitions
- `prompts/` -- Nunjucks agent prompt templates
- `scripts/` -- bash scripts for infrastructure phases
- `skills/` -- agent skill documentation

**User data** (lives in `~/.orchestrator/`):
- `config.yaml` -- agents, MCP servers, concurrency settings
- `state/` -- plan and ticket JSON files
- `logs/` -- execution logs

Example config (directory fields are optional -- smart defaults apply):

```yaml
defaultAgent: claude          # Global default coding agent

agents:                       # Agent CLI definitions
  claude:
    command: claude
    defaultArgs: ["--dangerously-skip-permissions"]
  codex:
    command: codex
    defaultArgs: ["--approval-mode", "never"]
  pi:
    command: pi
    defaultArgs: []

pollInterval: 10              # Seconds between daemon ticks
maxConcurrency: 3             # Max tickets running across all plans
ghCommand: gh                 # GitHub CLI binary

mcpServers:                   # MCP servers for the PI planning session
  linear:
    command: npx
    args: ["-y", "mcp-remote", "https://mcp.linear.app/mcp"]
```

Directory fields (`stateDir`, `logDir`, `workflowDir`, `promptDir`, `scriptDir`, `skillsDir`) can be set to override the defaults. Paths are resolved relative to the config file location.

### Custom Prompt Templates

Drop files into `~/.orchestrator/prompts/` to override individual agent prompts — no config change needed. Only the templates you provide are overridden; all others fall back to bundled defaults. See `docs/prompts.md` for the full list of templates and available template variables.

## Modifying the Code

### Dev Setup

```sh
nvm use
pnpm install
```

### Workflow

1. Write or modify code
2. `pnpm run lint:fix` -- auto-fix formatting and lint issues
3. `pnpm run typecheck` -- catch type errors
4. `pnpm run test` -- verify behavior

All three must pass before considering work complete.

### Key Conventions

- **Formatting**: Biome handles formatting and linting (not Prettier/ESLint). 2-space indentation, double quotes.
- **Types**: All data shapes are Zod schemas in `src/core/types.ts`. Export both the schema and inferred type.
- **Testing**: Vitest with explicit imports (`import { describe, it, expect } from "vitest"`). Test files colocated with source (`foo.test.ts`).

### Further Reading

- `mvp.md` -- full product requirements document
- `docs/workflows.md` -- workflow authoring reference
- `docs/prompts.md` -- prompt templates, variables, and customization
- `skills/config/SKILL.md` -- configuration reference
- `skills/planner/SKILL.md` -- plan/ticket JSON schemas
- `skills/workflows/SKILL.md` -- workflow authoring guide
