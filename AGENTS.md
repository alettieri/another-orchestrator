# Another Orchestrator

A CLI-driven orchestrator that separates planning (interactive LLM conversation) from execution (deterministic state machine).

## Architecture

```
orchestrator plan → interactive PI session → user describes work → PI creates state files
orchestrator daemon → reads state files → walks YAML workflows → dispatches headless agents
```

**Two processes, one interface:** The state directory (`state/plans/`) is the only interface between the planner and runner. The planner writes JSON files. The runner reads and updates them.

## Key Files

| File | Purpose |
|------|---------|
| `src/core/types.ts` | All Zod schemas and TypeScript types |
| `src/core/state.ts` | State manager — reads/writes plan and ticket JSON files |
| `src/core/runner.ts` | Runner — deterministic state machine that executes workflows |
| `src/core/config.ts` | Config loader — reads `orchestrator.yaml` |
| `src/core/workflow.ts` | Workflow loader — reads YAML workflow definitions |
| `src/agents/invoke.ts` | Agent invocation — spawns coding agents as subprocesses |
| `src/agents/interactive.ts` | Interactive spawner — launches PI with `stdio: inherit` |
| `src/cli.ts` | CLI entry point — all commands |
| `orchestrator.yaml` | Runtime configuration |

## Deep Documentation

For detailed reference on specific topics:

- **Planning**: `skills/planner/SKILL.md` — plan/ticket JSON schemas, field reference, examples, naming conventions
- **Workflows**: `skills/workflows/SKILL.md` — phase types, template variables, capture rules, authoring guide
- **Workflow registry**: `workflows/registry.yaml` — available workflows with descriptions
- **Linear integration**: `skills/providers/linear/SKILL.md` — fetching from Linear, field mapping
- **GitHub Issues**: `skills/providers/github-issues/SKILL.md` — fetching with `gh`, field mapping

## State Directory Layout

```
state/plans/
├── sprint-12-backend/
│   ├── plan.json              ← plan metadata + ticket list
│   └── tickets/
│       ├── PROJ-101.json      ← ticket execution state
│       └── PROJ-102.json
```

## CLI Commands

```sh
orchestrator plan [--repo <path>] [--workflow <name>]  # Interactive planning
orchestrator status [--plan <id>] [--json]             # View state
orchestrator run <planId> <ticketId>                    # Run single ticket
orchestrator daemon [--concurrency <n>]                 # Process all plans
orchestrator pause|resume <planId> <ticketId>           # Control tickets
orchestrator pause-plan|resume-plan <planId>            # Control plans
```

## Conventions

- **Runtime**: Node 24, pnpm, TypeScript strict mode
- **Formatting**: Biome — 2-space indent, double quotes, `pnpm run lint:fix`
- **Testing**: Vitest — explicit imports, test files next to source (`foo.test.ts`)
- **Types**: Zod schemas in `src/core/types.ts`, export both schema and inferred type
- **Validation**: `pnpm run lint:fix && pnpm run typecheck && pnpm run test`
