# Shell Environment

If `pnpm` is not found when running a command, load the correct Node version via nvm:
```sh
source ~/.nvm/nvm.sh && nvm use
```
Only run this once per session and only if needed.

# Another Orchestrator

CLI-driven orchestrator that separates planning (interactive LLM sessions) from execution (deterministic state machine).

## Step 1: Understand What You Need to Change

Before writing any code, identify:
- Which files are involved
- What behavior you expect after the change
- Whether this is a bug fix, new feature, refactor, or configuration change

Read the relevant source files first. Do not modify code you have not read.

## Step 2: Read the Required Documentation

Use this table to find the right reference material for your area of change:

| Area of Change | Read These |
|----------------|------------|
| Zod schemas / data types | `src/core/types.ts` |
| State file reading/writing | `src/core/state.ts` |
| Workflow execution engine | `src/core/runner.ts` |
| Agent spawning/invocation | `src/agents/invoke.ts` |
| CLI commands | `src/cli.ts` |
| YAML workflow definitions | `docs/workflows.md`, `skills/workflows/SKILL.md` |
| Plan/ticket JSON schemas | `skills/planner/SKILL.md` |
| Prompt templates | `docs/prompts.md` |
| Shell scripts | `scripts/` directory |
| Configuration | `src/core/config.ts`, `skills/config/SKILL.md` |
| Full architecture | `mvp.md` |

## Step 3: Follow Project Conventions

**Code style** -- Biome handles formatting and linting. 2-space indentation, double quotes. Run `pnpm run lint:fix` to auto-fix. Do not use Prettier or ESLint.

**Types** -- All data shapes are Zod schemas in `src/core/types.ts`. Export both the schema (`FooSchema`) and the inferred type (`Foo`). Prefer Zod defaults over optional fields where a sensible default exists.

**Testing** -- Vitest with explicit imports (`import { describe, it, expect } from "vitest"`). No globals. Test files live next to source: `foo.ts` -> `foo.test.ts`. One behavior per `it()` block.

## Step 4: Implement Your Changes

Key patterns used throughout the codebase:

- **StateManager** (`src/core/state.ts`) -- all plan/ticket file I/O goes through `createStateManager(stateDir)`. Methods: `listPlans`, `getPlan`, `savePlan`, `listTickets`, `getTicket`, `updateTicket`.
- **loadConfig** (`src/core/config.ts`) -- finds config via resolution chain (`--config` flag, `$ORCHESTRATOR_HOME`, `~/.orchestrator/config.yaml`, CWD fallback) and returns a validated `OrchestratorConfig`. Takes `{ configPath?, packageDir }` options.
- **loadWorkflow** (`src/core/workflow.ts`) -- reads YAML workflow definitions from the configured `workflowDir`.
- **renderTemplate** (`src/core/template.ts`) -- Nunjucks template rendering for prompt templates and script arguments.
- **Phase executors** (`src/phases/executor.ts`) -- handlers for each phase type (`script`, `agent`, `poll`, `terminal`). New phase types go here.
- **Agent invocation** (`src/agents/invoke.ts`) -- builds CLI arguments and spawns coding agents as subprocesses. The `resolveAgent` function in `src/core/config.ts` implements the four-level priority chain (phase -> ticket -> plan -> global default).

## Step 5: Validate Before Finishing

Run all three checks -- all must pass:
```sh
pnpm run lint:fix && pnpm run typecheck && pnpm run test
```

## Important: Do Not Create Plan Files Directly

Plans are created via `orchestrator interactive`, which launches an interactive PI coding agent session. Do not write or edit plan/ticket JSON files in `state/` by hand or programmatically unless you are modifying the state management code itself.

---

## Stack

- **Runtime**: Node 24 (see `.nvmrc`)
- **Package manager**: pnpm
- **Language**: TypeScript (strict mode, ES2022, Node16 module resolution)
- **Validation**: Zod schemas in `src/core/types.ts`
- **Linter/Formatter**: Biome (`biome.json`)
- **Test framework**: Vitest (no globals -- explicit imports from `vitest`)
- **CI**: GitHub Actions (`.github/workflows/ci.yml`)

## Commands

```sh
pnpm run lint        # biome check .
pnpm run lint:fix    # biome check --write .
pnpm run format      # biome format --write .
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest run
pnpm run test:watch  # vitest (watch mode)
pnpm run build       # tsc -> dist/
pnpm run dev         # tsx src/cli.ts (run without building)
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
    executor.ts               # Phase type handlers (script, agent, poll, terminal)
  utils/
    shell.ts                  # Subprocess execution
    logger.ts                 # Per-ticket file + console logging

workflows/
  standard.yaml               # Default feature workflow
  bugfix.yaml                 # Bug fix workflow
  minimal.yaml                # Single-phase testing workflow

prompts/                      # Nunjucks templates for agent phases
  interactive-system.md       # System prompt for PI interactive sessions
  implement.md
  implement-bugfix.md
  self-review.md
  simplify.md
  verify.md
  create-pr.md
  handle-review.md

scripts/                      # Bash scripts for infrastructure phases
  setup-worktree.sh
  check-pr-review.sh
  check-pr-merged.sh
  cleanup-worktree.sh

skills/                       # Agent Skills (progressive disclosure docs)
  config/SKILL.md             # Config file reference for interactive sessions
  planner/SKILL.md            # Plan/ticket JSON schemas + examples
  workflows/SKILL.md          # Workflow authoring guide
  providers/
    linear/SKILL.md           # Linear integration
    github-issues/SKILL.md    # GitHub Issues integration

docs/                         # Reference documentation
  workflows.md                # Workflow authoring reference
  prompts.md                  # Prompt templates, variables, and customization

~/.orchestrator/              # User data (external, created by `orchestrator init`)
  config.yaml                 # User configuration
  state/                      # Plan and ticket JSON files
  logs/                       # Per-ticket execution logs
```

## Key Source Files

| File | Purpose |
|------|---------|
| `src/core/types.ts` | All Zod schemas and TypeScript types |
| `src/core/state.ts` | State manager -- reads/writes plan and ticket JSON files |
| `src/core/runner.ts` | Runner -- deterministic state machine that executes workflows |
| `src/core/config.ts` | Config loader -- resolution chain, smart defaults for bundled vs user dirs |
| `src/core/workflow.ts` | Workflow loader -- reads YAML workflow definitions |
| `src/core/template.ts` | Nunjucks template renderer for prompts and script args |
| `src/phases/executor.ts` | Phase type handlers (script, agent, poll, terminal) |
| `src/agents/invoke.ts` | Agent invocation -- spawns coding agents as subprocesses |
| `src/agents/interactive.ts` | Interactive PI integration -- calls PI library directly with skills, system prompt, and question extension |
| `src/cli.ts` | CLI entry point -- all commands defined here |

## Deep Documentation

For detailed reference on specific topics:

- **Plan/ticket schemas**: `skills/planner/SKILL.md` -- JSON schemas, field reference, examples, naming conventions
- **Workflow authoring**: `skills/workflows/SKILL.md` -- phase types, template variables, capture rules, authoring guide
- **Workflow reference**: `docs/workflows.md` -- available workflows, phase type tables, scripts, prompt templates
- **Configuration**: `skills/config/SKILL.md` -- config file format, env vars, common modifications
- **Prompt templates**: `docs/prompts.md` -- all templates, available variables, custom prompt setup
- **Full architecture**: `mvp.md` -- complete product requirements document
