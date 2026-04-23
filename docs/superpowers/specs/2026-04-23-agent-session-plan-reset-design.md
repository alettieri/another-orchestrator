# Agent Session Plan Reset Design

## Summary

Replace the existing agent streaming/session execution plan with a fresh set of small, reviewable plans built from the original idea. The new structure uses one plan per technical layer, one ticket per plan, numeric plan IDs to make execution order explicit, and `paused` as the default initial status so downstream work is never picked up before deliberate review.

## Goals

- Restart planning for agent session work from a clean baseline rather than mutating the previous oversized plan.
- Break the work into small technical layers that can be reviewed and accepted independently.
- Keep CLI and TUI exposure out of the core session data-path plans.
- Make execution order obvious from plan naming rather than relying on one large dependency graph inside a single plan.

## Non-Goals

- Reusing or extending the existing `cross-agent-stream-sessions` plan.
- Combining multiple technical layers into a single ticket.
- Including CLI, TUI, or other user-facing session surfaces in the initial core plans.
- Changing runtime behavior in the first schema-focused plan.

## Plan Structure

The new session work should be represented as separate plans, each containing exactly one ticket. Plan IDs should use a simple numeric prefix followed by a concise slug.

Initial core sequence:

1. `01-agent-session-schema`
2. `02-agent-session-capture`
3. `03-agent-session-persistence`

Each plan starts in `paused` status. Activation is a manual decision after the prior plan has been reviewed and accepted.

## Execution Model

The numbered plans are the primary sequencing mechanism. Each plan is intentionally isolated so review happens at the layer boundary, not only inside phase history. This produces explicit contract gates:

- Plan 1 validates the session schema contract.
- Plan 2 validates production of structured session data at capture time.
- Plan 3 validates persistence and lifecycle semantics in runner/state handling.

Later CLI and TUI work should be handled in separate follow-on plans after the core data path is accepted.

## Plan Definitions

### `01-agent-session-schema`

Purpose: define the shared session contract and wire it through adjacent schema/state types without changing behavior.

Scope:

- Add `AgentSessionSchema` and exported `AgentSession` type.
- Thread the new session shape through relevant schema layers additively.
- Preserve compatibility fields such as legacy `sessionId` storage.
- Update schema and state-oriented tests for the new additive structure.

Out of scope:

- Provider stream parsing.
- Invocation or executor behavior changes.
- Runner persistence lifecycle changes.
- CLI or TUI changes.

Acceptance checks:

- A shared session schema exists in the core types layer.
- Related state schemas can represent the new session structure.
- Existing compatibility fields remain valid.
- No observable runtime behavior changes are introduced.

### `02-agent-session-capture`

Purpose: capture provider session metadata at the invocation/executor boundary using the shared schema from plan 1.

Scope:

- Update provider parsing to produce structured session data.
- Pass structured session data through invocation results.
- Allow executor-layer handling to receive and work with the new session structure.
- Add tests for provider capture behavior and malformed input handling.

Out of scope:

- Runner persistence semantics.
- CLI or TUI exposure.
- Broader status/output surface changes.

Acceptance checks:

- Provider capture produces structured session data using the shared schema.
- Invocation and executor paths can carry that data without relying only on legacy `sessionId`.
- Capture behavior is covered by focused tests.

### `03-agent-session-persistence`

Purpose: persist and clear structured session state correctly in runner/state handling, with no user-facing changes.

Scope:

- Persist current structured session state during execution where required.
- Record completed session metadata in phase history or equivalent persisted state.
- Clear current session state correctly as phases complete or fail.
- Add tests for session lifecycle persistence semantics.

Out of scope:

- `orchestrator status` updates.
- CLI session commands.
- TUI display, copy, or log rendering behavior.

Acceptance checks:

- Runner/state handling persists structured session data correctly.
- Session lifecycle transitions clear or retain state in the intended places.
- No CLI or TUI behavior changes are included.

## Review Model

Each plan should be reviewed as a contract check for one layer only:

- Schema plan: is the contract shape right?
- Capture plan: are providers producing the right structured data?
- Persistence plan: is the data stored and cleared correctly?

Acceptance criteria should explicitly exclude downstream work so reviewers can reject scope creep early.

## Rationale

The previous plan was too large because it mixed contract definition, runtime capture, persistence, and consumer behavior into a single execution thread. That made reviews noisy and forced downstream assumptions before upstream contracts had stabilized. The revised structure reduces coupling, makes rollback and re-planning simpler, and creates clearer acceptance boundaries.

## Follow-On Work

After the core sequence is complete, create separate numbered plans for user-facing session consumers such as:

- CLI session listing and resume behavior.
- TUI session display and copy behavior.
- TUI log loading and provider-specific log adapters.

Those plans should depend on the accepted persisted session model rather than redefining it.
