# Interactive Agent Launcher Design

## Summary

Refactor `orchestrator interactive` from a Claude-specific launcher into a provider-aware interactive session launcher that can start Claude, Codex, PI-style in-process agents, and future agents through one shared command surface. Preserve the current config-default behavior, add an optional `--agent` override, and move provider-specific setup behind built-in launch adapters plus a generic fallback.

## Goals

- Keep `orchestrator interactive` as the single entrypoint for planning sessions.
- Let users select an interactive agent explicitly with `--agent` while preserving `defaultAgent` as the fallback.
- Support Claude and Codex cleanly without sharing provider-specific flags.
- Preserve the original PI-style in-process interactive model as a supported transport.
- Make future agent support additive through a launcher abstraction rather than more branching in the command.

## Non-Goals

- Adding an interactive-capable flag to agent config.
- Defining a plugin system for third-party interactive launchers in this slice.
- Unifying all provider prompt, MCP, and skill semantics into one generic config format.
- Changing the plan-mode environment contract used by the interactive planner.
- Implementing interactive resume flows in this slice.

## Current State

The current interactive path is structurally generic only at the config level.

- `src/commands/interactive.ts` resolves the default agent from config, but then applies Claude-specific launch behavior unconditionally.
- The command reads `prompts/interactive-system.md` and injects it with Claude's `--append-system-prompt` flag.
- MCP server config is materialized into `.claude/mcp.json`.
- The skills directory is mounted with Claude's `--add-dir` flag.
- `src/agents/interactive.ts` currently exposes only a subprocess launcher, even though the earlier design included `runPiInteractive()` for in-process PI sessions.

This means Codex and future agents can be configured globally, but `orchestrator interactive` still assumes the selected agent speaks Claude's CLI contract.

## Decision

Introduce a provider-aware interactive launcher layer with a separate transport concept.

The command should resolve which agent to launch, then delegate all provider-specific preparation to a launcher planner. That planner returns an executable launch plan which can be either:

```ts
type InteractiveLaunchPlan =
  | {
      mode: "subprocess";
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    }
  | {
      mode: "in-process";
      runner: (opts: { args: string[]; cwd: string; env: Record<string, string> }) => Promise<void>;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    };
```

Built-in launchers handle known agents such as Claude, Codex, and PI. Unknown agents use a generic subprocess fallback with no provider-specific prompt, MCP, or skill wiring.

## Command Surface

`orchestrator interactive` remains the only planning-session entrypoint.

Behavior:

- If `--agent <name>` is provided, use that configured agent.
- Otherwise, use `config.defaultAgent`.
- If the selected agent name is missing from config, fail with the existing agent resolution error.

The command description and help text should stop implying that interactive mode is Claude-only.

Recommended CLI shape:

```text
orchestrator interactive [--repo <path>] [--workflow <name>] [--worktree-root <path>] [--agent <name>]
```

This keeps the default path stable while allowing explicit selection when the user wants Codex or another configured agent for planning.

## Architecture

### 1. Shared Plan Environment

`buildPlanEnv()` in `src/agents/interactive.ts` remains the shared contract for all interactive agents.

All launchers receive the same orchestrator planning environment:

- `ORCHESTRATOR_MODE=plan`
- state, workflow, prompt, script, skills, and config paths
- optional workflow override
- optional worktree root override
- resolved repo path

This keeps the planner's filesystem and environment contract stable across providers.

### 2. Provider vs Transport Split

The design should separate provider-specific setup from launch transport.

Provider responsibilities:

- system prompt injection
- MCP config generation
- skill exposure
- provider-specific argument shaping

Transport responsibilities:

- subprocess launch
- in-process function invocation
- cwd and env handoff

This split is required because the earlier PI implementation was not a plain subprocess wrapper. A future provider may also need in-process startup even if its setup semantics differ from PI.

### 3. Built-In Launchers

Add a launcher planner for built-in commands.

#### Claude

Preserve the current behavior, but isolate it behind a Claude launcher:

- read `interactive-system.md` if present
- inject it with Claude's system-prompt flag
- write MCP config in the Claude-specific `.claude/mcp.json` format
- expose the skills directory with `--add-dir`
- return a subprocess launch plan

#### Codex

Add a Codex launcher that uses Codex-specific CLI behavior rather than Claude flags.

Requirements:

- receive the same orchestrator plan env
- shape args specifically for Codex interactive usage
- avoid writing `.claude/mcp.json`
- avoid using Claude-only flags such as `--append-system-prompt` and `--add-dir`

The exact Codex CLI flags are an implementation detail, but they belong in the Codex launcher rather than the command handler.

#### PI / In-Process Agents

Restore support for in-process interactive startup through a dedicated launcher.

Behavior:

- preserve the earlier `runPiInteractive()` pattern
- switch cwd for the duration of the session
- merge orchestrator env into `process.env`
- invoke the agent library entrypoint directly
- restore cwd and environment after the session exits

This keeps the richer original interactive model available without forcing all agents through a subprocess-shaped interface.

### 4. Generic Fallback Launcher

Unknown configured agents should still be attempted.

Fallback behavior:

- use the configured command and `defaultArgs`
- pass the orchestrator plan environment
- launch as a subprocess
- do not inject provider-specific prompt flags
- do not materialize provider-specific MCP files
- do not assume a skill-mount mechanism

This gives future agents a safe minimum contract instead of failing early because they are not built in.

## Compatibility

The refactor should be behavior-preserving for current Claude users.

Expected compatibility outcomes:

- existing configs continue to work without modification
- `defaultAgent` remains the default for `interactive`
- Claude launch behavior remains functionally identical
- users can opt into Codex with `--agent codex` once configured
- future agents can be tried immediately through the fallback path

## Error Handling

- Missing configured agent names should continue to fail during resolution.
- Built-in launcher preparation failures should produce provider-specific errors.
- Failure to read `interactive-system.md` should remain non-fatal for launchers that treat it as optional.
- Failure to write provider-specific MCP config should fail the affected launcher rather than silently launching in a degraded mode.
- Generic fallback launchers should fail only on normal subprocess startup/runtime errors.

## Testing

Add focused tests around launch planning and command behavior.

### `src/commands/interactive.test.ts` or equivalent

- uses `defaultAgent` when `--agent` is not provided
- prefers `--agent` over `defaultAgent`
- reports the selected agent in console output

### `src/agents/interactive.test.ts`

- Claude launcher returns a subprocess plan with prompt injection, Claude MCP path, and skills dir mounting
- Codex launcher returns a subprocess plan without Claude-only flags or `.claude/mcp.json`
- PI launcher returns an in-process plan and preserves cwd/env restoration
- unknown commands use the generic subprocess fallback
- shared plan env remains identical across launchers

### Regression Coverage

- Claude interactive behavior remains unchanged from the current implementation
- the in-process PI runner still restores process cwd and environment after completion

## Rollout

Implement in three steps:

1. Extract the launcher abstraction and convert Claude to use it without changing behavior.
2. Add Codex and PI/in-process built-in launchers on top of that abstraction.
3. Update docs and examples so interactive mode is described as agent-selectable rather than Claude-specific.

This reduces risk by making the first step a pure refactor with a narrow behavioral surface.
