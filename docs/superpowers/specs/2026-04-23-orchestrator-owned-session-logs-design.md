# Orchestrator-Owned Session Logs Design

## Summary

Replace provider-owned transcript lookup in the TUI logs screen with orchestrator-owned per-session structured logs. Orchestrator should persist normalized JSONL events under each plan directory, keyed per ticket and per session, so the TUI can tail live session activity without depending on provider-private storage layouts such as `~/.claude/projects/...`.

## Goals

- Make session logs provider-aware without relying on provider-specific transcript files.
- Persist live structured session logs as orchestrator-owned artifacts.
- Store logs under the plan directory so they share the plan lifecycle.
- Tail per-session logs in the TUI as soon as a session is identified.
- Keep the log event model useful for live reading across Claude and Codex.

## Non-Goals

- Capturing pre-session output before a session ID exists.
- Preserving compatibility with the current provider-owned transcript lookup path.
- Storing raw provider event streams alongside normalized events.
- Solving Codex and Claude transcript discovery independently of orchestrator-owned logs.

## Current State

The current logs screen is effectively Claude-specific:

- `src/tui/screens/TicketLogsScreen.helpers.ts` resolves log files with `resolveSessionPath(worktree, sessionId)`.
- That path is hardcoded to `~/.claude/projects/<sanitized-worktree>/<sessionId>.jsonl`.
- `useSessionLogs` and its tests already filter to Claude sessions in practice.
- `TicketLogsScreen` renders derived `phase-divider` events for readability, but those dividers are UI structure, not provider data.

This makes the log viewer brittle and provider-dependent. It also assumes orchestrator can always rediscover provider transcripts later, which is the wrong boundary once session metadata becomes provider-aware.

## Decision

Orchestrator becomes the system of record for session logs.

The TUI logs screen should no longer read provider-owned transcript files directly. Instead, orchestrator should write structured JSONL events to a per-session file once the session is identified, and the TUI should read those orchestrator-owned files.

## Storage Model

### Ownership

Session logs are persisted under the plan directory so they are deleted when the plan is deleted.

### Layout

Recommended layout:

```text
<stateDir>/plans/<planId>/sessions/<ticketId>/<sessionId>.jsonl
```

Properties of this layout:

- logs are grouped under the plan
- each ticket has its own session directory
- each session has exactly one append-only JSONL file
- file naming does not encode provider-specific storage assumptions

### Write Timing

Orchestrator starts writing a session log file only after the session has been identified.

Implications:

- no temporary bootstrap file is created before session identification
- a running phase may briefly have no visible log stream
- once `currentSession` exists, new normalized events are appended live to that session file

This is acceptable because immediate visibility matters, but pre-session output is not required for this design.

## Event Model

Persist normalized high-value events only.

Recommended baseline event types:

```ts
type SessionLogEvent =
  | {
      type: "session-start";
      timestamp: string;
      session: { id: string; provider: "claude" | "codex" };
      phase: string;
    }
  | {
      type: "assistant-text";
      timestamp: string;
      text: string;
    }
  | {
      type: "tool-use";
      timestamp: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool-result";
      timestamp: string;
      name: string;
      output: unknown;
      isError?: boolean;
    }
  | {
      type: "warning";
      timestamp: string;
      message: string;
    };
```

### Included Data

- `session-start` marks the beginning of a persisted session stream and records provider plus phase context.
- `assistant-text` stores readable assistant output.
- `tool-use` stores tool name and compact structured input.
- `tool-result` stores the outcome of a tool invocation when the provider exposes it.
- `warning` stores non-fatal issues worth surfacing in the log stream.

### Excluded Data

- UI-only artifacts such as `phase-divider`
- raw provider events
- provider-private path metadata

The TUI can derive dividers from session boundaries and phase metadata during rendering.

## Write Path

### Provider Normalization

Provider parsers or the invocation layer should normalize streamed output into session-log events before they are written.

Responsibilities:

- identify the session
- normalize provider-specific output into the shared log event shape
- forward normalized events to the session-log writer

Validated mappings from the live CLIs:

- Claude:
  - `system/init.session_id` → `session-start`
  - `assistant.message.content[].tool_use` → `tool-use`
  - `user.message.content[].tool_result` → `tool-result`
  - `assistant.message.content[].text` → `assistant-text`
- Codex:
  - `thread.started.thread_id` → `session-start`
  - `item.type:"agent_message"` → `assistant-text`
  - `item.type:"command_execution"` start/completion events → `tool-use` and `tool-result`

This mapping is sufficient to construct a useful provider-agnostic structured log stream from both providers.

### Session Log Writer

Introduce an orchestrator-owned append-only writer responsible for:

- creating `plans/<planId>/sessions/<ticketId>/` as needed
- creating `<sessionId>.jsonl` on first write
- appending one JSON object per line
- keeping writes scoped to the active session for the current ticket/phase

The writer should be invoked only after session identification. Before then, streamed output is not persisted in the session file.

## Read Path

### TUI Hook

`useSessionLogs` should become provider-agnostic.

Instead of resolving provider transcript paths, it should:

1. inspect the ticket's known sessions from `currentSession` and `phaseHistory`
2. resolve orchestrator-owned session file paths under the plan directory
3. watch those files for append changes
4. parse normalized JSONL events
5. return a unified event stream to the logs screen

### Ticket Log Ordering

The TUI should preserve the current human model of log reading:

- order session streams by ticket phase/session order
- synthesize visual separators between session blocks
- tail the active session when it is growing

`phase-divider` remains a rendering concern, not a stored event.

### Empty State

Before a running phase has an identified session, the logs screen should show nothing for that phase.

This is a deliberate design choice:

- no temporary bootstrap log file exists
- no synthetic placeholder event is persisted
- once the session exists, the stream appears and begins tailing normally

## Error Handling

- Malformed JSONL lines in a session log file are skipped, not fatal.
- Missing session files are treated as empty streams.
- Watched files disappearing due to plan removal or cleanup should not crash the TUI.
- Provider output that cannot be normalized into a supported event should be dropped or converted into a `warning` event when useful.

## Testing

Add or update focused tests around the new ownership model.

### Log Path Helpers / Writer

- resolves per-session log paths under `plans/<planId>/sessions/<ticketId>/<sessionId>.jsonl`
- creates directories lazily
- appends JSONL events in order

### Invocation / Capture

- begins writing only after session identification
- appends normalized `assistant-text` and `tool-use` events after session start
- appends normalized `tool-result` events when provider output includes them
- does not write pre-session output

### `useSessionLogs`

- reads orchestrator-owned session files rather than provider transcript files
- tails append-only file changes
- gracefully handles missing files
- remains provider-agnostic

### `TicketLogsScreen`

- renders synthesized dividers between session blocks
- renders normalized assistant and tool events
- handles empty state before session identification

## Implementation Sequence

1. Introduce a normalized session-log event schema and path helper for orchestrator-owned session files.
2. Add an append-only session-log writer under the plan directory.
3. Update invocation/capture flow to emit normalized events into the writer once the session is known.
4. Replace provider transcript path resolution in `useSessionLogs` with orchestrator-owned session file discovery and watching.
5. Simplify `TicketLogsScreen.helpers.ts` so it parses normalized orchestrator events and derives UI-only dividers at render time.

## Trade-Offs

### Why orchestrator-owned logs

This removes the dependency on provider-private storage layouts and gives both Claude and Codex the same visibility model.

### Why per-session files

Per-session files align with how users reason about live agent activity and allow the TUI to tail the active session directly.

### Why not store raw provider events

Raw provider events would increase storage cost and couple the log pipeline to unstable provider schemas. Normalized events are enough for the TUI and easier to evolve.

### Why allow a short no-log window

The design intentionally does not persist output before session identification. This avoids temporary files and handoff complexity, and the user explicitly accepted that logs may appear only after the session is known.

## Acceptance Criteria

- The TUI logs pipeline no longer depends on provider-owned transcript files such as `~/.claude/projects/...`.
- Orchestrator persists per-session structured JSONL logs under the plan directory.
- Session logs are stored per ticket and per session.
- Session log writing begins only after the session is identified.
- The persisted event model is normalized and provider-agnostic.
- The TUI logs screen reads orchestrator-owned session files and tails live updates.
- UI-only structures like phase dividers are derived at render time, not persisted.
