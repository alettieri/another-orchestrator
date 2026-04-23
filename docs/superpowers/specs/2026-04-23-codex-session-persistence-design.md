# Codex Session Persistence Design

## Summary

Unify agent session persistence around one provider-aware structured session object and extend capture to Codex. Remove legacy raw `sessionId` fields, capture Codex session identifiers from `codex exec --json`, persist them through runner state, and expose them through the existing status and TUI session surfaces.

## Goals

- Capture a stable Codex session identifier during `codex exec`.
- Persist Claude and Codex sessions through one shared state contract.
- Remove legacy `currentSessionId` and `phaseHistory[].sessionId` fields.
- Expose the structured session in `orchestrator status` and the TUI session column.
- Make the TUI copy action generate a provider-specific resume command.

## Non-Goals

- Backward-compatible migration for existing ticket state files.
- Codex log-file support in the TUI logs screen.
- Provider-specific session payloads beyond `id` and `provider`.
- Defining the full interactive resume command surface in this slice.

## Current State

The repo already has partial structured session plumbing:

- `src/core/types.ts` defines `AgentSession` as `{ id: string }`.
- `src/agents/invoke.ts` captures Claude `session_id` into both `sessionId` and `session`.
- `src/phases/executor.ts` persists `currentSessionId` and `currentSession` during execution.
- `src/core/runner.ts` still records only legacy `sessionId` in phase history and clears only `currentSessionId` on completion paths.
- `src/commands/status.ts`, `src/tui/screens/TicketsScreen.helpers.ts`, and `src/tui/components/SessionCopyCell.tsx` still rely on raw session ID fields.

Codex currently runs through `codex exec` without any session capture, even though `codex exec --json` emits a `thread.started` event with a stable `thread_id`.

## Decision

Adopt a clean cut to a single canonical session contract:

```ts
type AgentSession = {
  id: string;
  provider: "claude" | "codex";
};
```

No legacy fields remain in persisted state. No read-time migration layer is added.

## Architecture

### 1. Core Types

`src/core/types.ts` is the contract boundary.

Changes:

- Extend `AgentSessionSchema` to require `provider`.
- Remove `sessionId` from `PhaseHistoryEntrySchema`.
- Remove `currentSessionId` from `TicketStateSchema`.
- Keep `session?: AgentSession` in phase history.
- Keep `currentSession: AgentSession | null` on the ticket for in-flight visibility.

Result:

- One persisted session shape exists everywhere.
- Consumers no longer need to reconcile structured and legacy fields.

### 2. Agent Invocation

`src/agents/invoke.ts` is the provider-normalization boundary.

Claude:

- Continue parsing the first `system/init` event.
- Convert Claude `session_id` into `{ id, provider: "claude" }`.

Codex:

- Invoke Codex in JSON mode so the output is machine-readable.
- Parse the first `thread.started` event.
- Convert `thread_id` into `{ id, provider: "codex" }`.

Generic behavior:

- `AgentResult` carries only `session?: AgentSession`.
- `AgentCallbacks` carries only `onSession?: (session: AgentSession) => void`.
- Any provider-specific raw identifier is normalized before leaving this layer.

### 3. Executor Persistence

`src/phases/executor.ts` remains the live persistence hook during agent execution.

Changes:

- Persist only `currentSession` while an agent phase is running.
- Remove writes to `currentSessionId`.
- Keep the session callback additive and best-effort: if the state write fails, log a warning and continue the phase.

Codex missing session behavior:

- If `codex exec --json` completes without a `thread_id`, do not fail the phase.
- Log a warning that the Codex session ID was not captured.
- Leave `currentSession` unset.

### 4. Runner Lifecycle

`src/core/runner.ts` owns session lifecycle transitions.

Changes:

- Persist `session` into each `PhaseHistoryEntry`.
- Clear `currentSession` on all phase exit paths:
  - success with terminal completion
  - success with next-phase transition
  - retry of same phase
  - failure
  - thrown executor error
- Remove all legacy `currentSessionId` handling.

This makes persisted state internally consistent:

- in-flight session lives at `currentSession`
- historical session lives at `phaseHistory[].session`

## Consumer Design

### Status Command

`src/commands/status.ts` should read the latest structured session.

Lookup policy:

1. If the ticket is running and `currentSession` exists, show that.
2. Otherwise, scan `phaseHistory` from newest to oldest and return the first entry with `session`.

Display format:

- Include provider and ID.
- Example: `Session: codex 019dbbdd-c498-7490-98e6-b01dcd46b8bb (implement)`

This preserves current usefulness while making provider identity explicit.

### TUI Session Column

`src/tui/screens/TicketsScreen.helpers.ts` should adopt the same lookup policy as status.

Display behavior:

- Prefer live `currentSession`.
- Fall back to latest historical `session`.
- Render a compact provider hint in the cell, not just the truncated ID.

Recommended format:

- Claude: `cl:cc807f8c…`
- Codex: `cx:019dbbdd…`

The provider prefix keeps the table compact while making copy behavior predictable.

### TUI Copy Resume Command

`src/tui/components/SessionCopyCell.tsx` should stop hardcoding Claude.

Behavior:

- Accept the structured session object instead of a raw string ID.
- Derive the copied command from `session.provider`.
- Claude copies `claude --resume <id>`.
- Codex copies the Codex resume command determined during implementation.

This design keeps state minimal while letting the UI synthesize provider-specific commands.

### Out of Scope Consumers

The following paths should not block the contract cut:

- `src/commands/sessions.ts`
- `src/tui/screens/TicketLogsScreen.helpers.ts`

They currently assume Claude-specific behavior and should be treated as follow-on work after the core contract and first consumers are stable.

## Parsing Strategy

### Claude

Continue line-by-line JSON parsing of the stream output. The first valid init event with `session_id` wins.

### Codex

Run `codex exec` with `--json` and parse line-by-line JSONL output.

Expected event:

```json
{"type":"thread.started","thread_id":"019dbbdd-c498-7490-98e6-b01dcd46b8bb"}
```

Rules:

- The first valid `thread.started` event wins.
- Ignore malformed lines.
- Ignore unrelated events such as `turn.started`, `item.completed`, and `turn.completed`.
- If no valid `thread_id` is seen, log a warning and continue without a session.

## Error Handling

- Session capture failure must not overwrite the actual phase success/failure result unless the whole subprocess invocation fails.
- JSON parse errors are non-fatal and skipped line-by-line.
- State persistence failures for `currentSession` are warnings, not fatal execution errors.
- Missing Codex session IDs are warnings, not fatal errors.

## Testing

Add or update focused tests in the existing adjacent suites.

### `src/agents/invoke.test.ts`

- Claude parser returns `{ id, provider: "claude" }`.
- Codex parser returns `{ id, provider: "codex" }` from `thread.started`.
- Codex parser ignores unrelated JSONL events.
- Codex parser tolerates malformed JSONL lines.
- Missing Codex session ID leaves `session` undefined.

### `src/phases/executor.test.ts`

- Agent phase persists only `currentSession`.
- Codex missing-session run logs warning but still returns success when the subprocess succeeds.

### `src/core/runner.test.ts`

- Runner writes `phaseHistory[].session`.
- Runner clears `currentSession` on success, failure, retry, and transition paths.
- No legacy session ID fields remain in writes.

### `src/commands/status` tests

- Status prefers `currentSession` for running tickets.
- Status falls back to latest historical `session`.
- Status prints provider and ID.

### TUI tests

- `TicketsScreen.helpers` prefers `currentSession`, then latest `phaseHistory[].session`.
- `SessionCopyCell` builds provider-specific resume commands.
- Session column renders a provider hint plus truncated ID.

## Implementation Sequence

1. Update `AgentSession` and remove legacy session ID fields from state schemas.
2. Update invocation parsing so Claude and Codex both emit provider-aware `AgentSession` objects.
3. Update executor and runner persistence to use only structured session state.
4. Update `status` and TUI session surfaces to read structured sessions and synthesize provider-specific copy commands.
5. Clean up remaining Claude-only session consumers in follow-on work.

## Trade-Offs

### Why remove legacy fields now

Keeping both `sessionId` and `session` would preserve ambiguity and force every consumer to define precedence rules. Since no compatibility layer is required, a clean cut reduces implementation and testing complexity.

### Why store `provider`

Provider is required for correct downstream behavior even with a minimal state object:

- display which system produced the session
- copy the correct resume command
- avoid guessing from the session ID format

### Why not store a resume command directly

A stored command string would duplicate derivable logic and lock state to a CLI surface that may evolve. The state only needs stable identity plus provider; consumers can derive the command.

## Acceptance Criteria

- `AgentSession` is the only persisted session contract and includes `provider`.
- No legacy raw session ID fields remain in ticket or phase-history schemas.
- Claude and Codex invocation paths both emit normalized structured sessions.
- Codex uses `thread.started.thread_id` as the captured session identifier.
- Missing Codex session IDs log warnings without failing otherwise successful phases.
- Runner persists historical sessions and clears in-flight session state consistently.
- `orchestrator status` and the TUI session column both read the unified structured session state.
- TUI copy behavior becomes provider-aware.
