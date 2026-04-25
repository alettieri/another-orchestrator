# Shared MCP Support Design

## Summary

Extend orchestrator MCP support from a Claude-only interactive integration to a shared provider-aware MCP pipeline that works for both `orchestrator interactive` and runner-driven agent phases. Keep `mcpServers` as the single provider-agnostic config surface, normalize it once, and translate it into provider-specific launch artifacts for Claude and Codex while skipping unsupported servers with warnings.

## Goals

- Keep `mcpServers` as the canonical MCP configuration surface in orchestrator config.
- Support MCP translation for both Claude and Codex.
- Reuse the same MCP preparation logic in interactive and runner execution paths.
- Skip per-server translation failures with warnings instead of failing the entire launch.
- Preserve current Claude behavior for already supported MCP setups.

## Non-Goals

- Introducing provider-specific MCP config sections in `config.yaml`.
- Defining a universal MCP config file format shared directly by Claude and Codex.
- Supporting MCP automatically for unknown agent providers.
- Expanding the config schema beyond the current server definition of command, args, and env.
- Changing the underlying MCP protocol or modeling features beyond what the configured provider actually supports.

## Current State

MCP support is currently isolated to the interactive Claude path.

- `src/core/types.ts` defines a global `mcpServers` config block with `command`, `args`, and optional `env`.
- `src/commands/interactive.ts` resolves the config and launches an interactive agent through `buildInteractiveLaunchPlan()`.
- The current built-in Claude interactive launcher materializes a Claude-specific MCP config file and passes the Claude-specific flag.
- Runner-driven agent invocation does not share that MCP preparation path.
- Codex has no provider-specific MCP translation path today.

This creates two problems:

- MCP behavior is not shared between planning and execution.
- The user-facing config is provider-agnostic, but the implementation is Claude-specific.

## Decision

Introduce a shared MCP preparation module that converts orchestrator config into provider-specific launch artifacts.

The MCP pipeline should have four stages:

1. Read and normalize `config.mcpServers`.
2. Resolve `${ENV_VAR}` interpolation into a normalized internal server model.
3. Translate normalized servers for a specific provider.
4. Materialize any provider-specific launch artifacts such as config files, args, or env additions.

Each translation returns both launch data and warnings. A server that cannot be translated for the selected provider is skipped with a warning instead of failing the launch.

## Internal Contract

The internal contract should be provider-agnostic and small.

Recommended normalized shape:

```ts
type NormalizedMcpServer = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};
```

Recommended preparation result shape:

```ts
type PreparedMcpLaunch = {
  args: string[];
  env: Record<string, string>;
  tempFiles: string[];
  warnings: Array<{
    serverName?: string;
    provider: string;
    message: string;
  }>;
};
```

This contract is not user-facing. It exists to keep translation logic shared across launch paths.

## Architecture

### 1. Shared MCP Preparation Module

Add a shared module, for example under `src/agents/` or `src/core/`, responsible for:

- reading `config.mcpServers`
- resolving env interpolation
- normalizing server definitions
- translating to provider-specific launch data
- returning warnings and any temporary file paths that may need lifecycle management

This becomes the single MCP boundary for the application.

### 2. Provider-Specific Translation

The shared module should delegate provider rendering to built-in translators.

#### Claude

Preserve the current model:

- render a Claude-compatible MCP config structure
- write the config file in the expected Claude format
- add the Claude-specific launch flag

This slice should keep existing Claude behavior stable.

#### Codex

Add a Codex translator:

- render only the subset of normalized MCP server data that Codex supports
- materialize MCP config in Codex's supported config shape
- pass the Codex-specific launch mechanism rather than reusing Claude flags or `.claude/mcp.json`

Codex configuration details are provider-specific implementation details and belong entirely in this translator.

#### Unknown Providers

Unknown providers should not receive MCP by default.

Behavior:

- return no MCP launch artifacts
- emit one warning that MCP is unsupported for that provider

This avoids pretending that provider-agnostic config implies provider-agnostic launcher support.

### 3. Interactive Path Integration

`buildInteractiveLaunchPlan()` should call the shared MCP module as part of provider launch planning.

Result:

- interactive Claude gets MCP through the shared module
- interactive Codex gets MCP through the same shared module
- warnings can be surfaced before or during launch

This removes the remaining Claude-only MCP branching from the interactive path.

### 4. Runner Path Integration

Runner-driven agent invocation should reuse the same MCP preparation layer before spawning `claude` or `codex`.

Likely integration point:

- the agent invocation or phase execution boundary where provider-specific command args are assembled

Result:

- a ticket using Codex in a runner phase can receive the same MCP server set as an interactive Codex session
- Claude and Codex stay aligned between planning and execution
- future provider-specific MCP support can be added in one place

## Warnings and Failure Behavior

### Per-Server Translation Failures

If one server cannot be translated for a provider:

- skip that server
- include a warning with the provider and server name
- continue preparing the rest of the launch

This is the default degraded path requested by the user.

### Unsupported Providers

If the selected agent provider has no MCP translator:

- skip MCP entirely
- return a single warning that MCP is unsupported for that provider

### Temporary Artifact Failures

If orchestrator fails while writing a provider-specific MCP artifact needed for a supported provider:

- fail that launch

This is different from per-server translation failure. Once a supported provider translation succeeds, orchestrator should not silently launch a broken partial artifact set caused by local file I/O failure.

### Config Validation

Schema validation remains unchanged:

- malformed `mcpServers` config still fails during normal config parsing
- only provider translation is best-effort

## Environment Interpolation

Interpolation should remain centralized and consistent across providers.

Rules:

- resolve `${VAR_NAME}` from the current process environment
- replace missing variables with empty strings, matching current behavior unless implementation review decides to tighten this
- apply interpolation once before provider translation

This ensures Claude and Codex receive the same resolved values from the same config entry.

## Lifecycle and Cleanup

Provider-specific MCP artifacts may require temporary files.

The shared preparation result should make cleanup explicit:

- return created temporary file paths
- let the caller decide when cleanup is safe

For interactive sessions, cleanup may happen after the child exits. For runner-driven subprocesses, cleanup may happen after invocation completes.

If an implementation chooses durable files instead of temporary ones for a provider, that should be a deliberate provider-specific decision documented in code.

## Testing

Add focused tests around the shared MCP module and thin integration coverage at the call sites.

### Shared MCP Module

- normalizes `mcpServers` into the internal server model
- interpolates `${ENV_VAR}` values correctly
- renders Claude launch artifacts
- renders Codex launch artifacts
- skips unsupported or untranslatable servers with warnings
- warns once for unsupported providers

### Interactive Integration

- interactive Claude launch includes MCP artifacts from the shared module
- interactive Codex launch includes MCP artifacts from the shared module
- interactive unknown provider proceeds without MCP and surfaces warnings

### Runner Integration

- Claude agent invocation includes translated MCP launch artifacts
- Codex agent invocation includes translated MCP launch artifacts
- warnings are logged when servers are skipped
- unknown providers run without MCP rather than failing

### Regression Coverage

- existing Claude interactive MCP behavior remains unchanged
- shared env interpolation produces the same effective values across interactive and runner contexts

## Documentation

Update docs to describe `mcpServers` as shared provider-agnostic config translated per provider.

Important points to document:

- Claude and Codex are both supported
- provider support is not universal just because MCP itself is standardized
- unsupported providers or untranslatable servers are skipped with warnings
- `mcpServers` remains the only MCP config surface users edit

## Rollout

Implement in five steps:

1. Extract MCP normalization and Claude translation out of the current interactive launcher path.
2. Switch interactive Claude to the shared module without changing behavior.
3. Add Codex translation support.
4. Reuse the same MCP module in runner-driven agent invocation.
5. Update docs and examples to describe the shared MCP model.

This rollout keeps the first step low-risk and avoids introducing Codex-specific logic before the shared boundary exists.
