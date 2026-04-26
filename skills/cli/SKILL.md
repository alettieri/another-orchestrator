---
name: cli
description: Use and explain the orchestrator CLI commands
---

# CLI Skill

This skill teaches you how to use and explain the orchestrator's CLI commands during an interactive session.

## Overview

The CLI is the human interface to the orchestrator. It has two main modes:

- **Interactive** (`orchestrator interactive`) -- launches a planning session where you (the agent) help the user create plans, configure the system, and organize work.
- **Execution** (`orchestrator daemon`, `orchestrator run`) -- a deterministic state machine that reads plans and dispatches headless coding agents through YAML workflows.

All commands accept `-C, --config <path>` to use a specific config file instead of the default.

## Command Reference

### Setup

| Command | Description |
|---------|-------------|
| `orchestrator init [--dir <path>]` | Create `~/.orchestrator/` with default config, state, and logs dirs. `--dir` overrides the target directory. |

### Planning

| Command | Description |
|---------|-------------|
| `orchestrator interactive [--repo <path>] [--workflow <name>] [--worktree-root <path>] [--launcher <name>]` | Launch an interactive planning session. Uses `defaultAgent` from config unless `--launcher <name>` selects another configured launcher. `--repo` sets the target workspace (default: CWD). `--workflow` sets the default workflow for new plans. |

### Execution

| Command | Description |
|---------|-------------|
| `orchestrator daemon [--concurrency <n>] [--agent <name>]` | Start the daemon loop. Processes tickets continuously until stopped (Ctrl+C). `--concurrency` overrides `maxConcurrency`. `--agent` overrides `defaultAgent`. |
| `orchestrator run <planId> <ticketId>` | Run a single ticket through its workflow. Blocks until done. Useful for debugging. |
| `orchestrator tick` | Run a single daemon tick and exit. Processes one round of ready tickets. |

### Status

| Command | Description |
|---------|-------------|
| `orchestrator status [--plan <id>] [--json]` | Show plan and ticket status. `--plan` filters to a specific plan. `--json` outputs raw JSON. |

### Ticket Control

| Command | Description |
|---------|-------------|
| `orchestrator pause <planId> <ticketId>` | Pause a running ticket. The daemon will skip it until resumed. |
| `orchestrator resume <planId> <ticketId>` | Resume a paused ticket. Sets it back to ready. |
| `orchestrator skip <planId> <ticketId> <phase>` | Skip a ticket to a specific workflow phase. Useful to jump past a stuck phase. |
| `orchestrator retry <planId> <ticketId>` | Reset retries and re-run the current phase. Clears the error and sets the ticket back to ready. |

### Plan Control

| Command | Description |
|---------|-------------|
| `orchestrator pause-plan <planId>` | Pause an entire plan. The daemon will skip all tickets in this plan. |
| `orchestrator resume-plan <planId>` | Resume a paused plan. Sets it back to active. |

## Common Workflows

### First-Time Setup

```sh
orchestrator init          # creates ~/.orchestrator/ with config, state, logs
orchestrator interactive                 # launch with config defaultAgent
orchestrator interactive --launcher codex   # launch with a configured launcher override
# ... create plans interactively ...
orchestrator daemon        # start processing tickets
```

### Choosing the Interactive Launcher

`orchestrator interactive` uses `defaultAgent` unless `--launcher <name>` selects another configured launcher for this planning session only.

Launcher behavior is provider-aware:

- Claude uses the Claude subprocess launcher with Claude-specific prompt and skills setup.
- Claude and Codex use MCP servers from the shared `mcpServers` config.
- Codex and other configured agents use a generic subprocess launcher with the shared planning environment.
- PI-style agents use the in-process interactive launcher.

MCP itself is standardized, but provider launch/config surfaces differ. Providers without MCP translation support run without MCP and emit a warning. If one server cannot be translated for the selected provider, that server is skipped with a warning while any remaining servers are still passed through.

### Check Progress

```sh
orchestrator status                  # overview of all plans
orchestrator status --plan <id>      # detailed view of one plan
orchestrator status --json           # machine-readable output
```

### Intervene on a Stuck Ticket

```sh
orchestrator pause <planId> <ticketId>    # stop the ticket
# ... investigate and fix the issue ...
orchestrator retry <planId> <ticketId>    # retry the current phase
# or
orchestrator skip <planId> <ticketId> <phase>   # jump to a different phase
```

### Debug a Single Ticket

```sh
orchestrator run <planId> <ticketId>   # run one ticket, see output in real time
```

### Pause and Resume a Plan

```sh
orchestrator pause-plan <planId>     # pause all work on a plan
orchestrator resume-plan <planId>    # resume when ready
```

## What You Can Do

As the interactive agent, you should reference CLI commands when helping the user:

- **After creating a plan**: Tell the user to run `orchestrator daemon` to start processing, or `orchestrator run <planId> <ticketId>` to test a single ticket.
- **When asked about progress**: Suggest `orchestrator status` or `orchestrator status --plan <id>`.
- **When a ticket is stuck**: Walk the user through `pause` + `retry` or `skip`.
- **When the user wants to stop work**: Suggest `orchestrator pause-plan <planId>`.
- **For first-time users**: Walk them through `init` -> `interactive` -> `daemon`.

You are running inside `orchestrator interactive`. You cannot run these commands yourself -- they are for the user to run in a separate terminal. When suggesting commands, use the actual plan IDs and ticket IDs from the current state if available.
