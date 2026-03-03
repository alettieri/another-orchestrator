---
description: Create orchestrator plans and tickets from work items
---

# Planner Skill

You are the LLM planner for the Agent Orchestrator. Your job is to take work items from project management tools (Linear, GitHub Issues, or manual input) and produce the JSON state files that the deterministic runner consumes.

## How the System Works

The orchestrator has two processes:

1. **You (the planner)** — reason about tickets, dependencies, and priorities, then write JSON files to disk.
2. **The runner** — a deterministic state machine that reads those JSON files, walks a YAML workflow, and dispatches headless coding agents.

The only interface between you and the runner is the `state/` directory. You write files. The runner reads and updates them. You never call each other directly.

## State Directory Structure

The state directory location is controlled by the `stateDir` setting in the orchestrator config file. During interactive sessions, the resolved path is available as `$ORCHESTRATOR_STATE_DIR`. To understand how the config file is found and what other directories are configurable, see the **Config Skill** (`skills/config/SKILL.md`).

```
<stateDir>/plans/
├── sprint-12-backend/
│   ├── plan.json                  ← plan metadata + ticket list
│   └── tickets/
│       ├── PROJ-101.json          ← ticket state
│       ├── PROJ-102.json
│       └── PROJ-103.json
├── hotfix-auth/
│   ├── plan.json
│   └── tickets/
│       └── PROJ-200.json
```

By default, `stateDir` resolves to `~/.orchestrator/state` (created by `orchestrator init`). If overridden in config, it is resolved relative to the config file location.

Each plan is a directory under `<stateDir>/plans/`. The plan metadata lives in `plan.json`. Each ticket gets its own file under `tickets/`.

## Plan File Schema (`plan.json`)

```json
{
  "id": "sprint-12-backend",
  "name": "Sprint 12 — Backend Team",
  "createdAt": "2026-02-28T10:00:00Z",
  "createdBy": "planner",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "standard",
  "agent": null,
  "worktreeRoot": "/Users/sam/worktrees",
  "status": "active",
  "tickets": [
    { "ticketId": "PROJ-101", "order": 1, "blockedBy": [] },
    { "ticketId": "PROJ-102", "order": 2, "blockedBy": ["PROJ-101"] },
    { "ticketId": "PROJ-103", "order": 1, "blockedBy": [] }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | URL-safe slug. Used as the directory name. Use lowercase with hyphens. |
| `name` | string | yes | Human-readable name. |
| `createdAt` | string | yes | ISO 8601 timestamp. |
| `createdBy` | string | yes | Who created this plan (e.g. `"planner"`). |
| `repo` | string \| null | no | Default repo for tickets. `null` for multi-repo plans where each ticket specifies its own repo. |
| `workflow` | string | yes | Workflow name (matches the `name` field in a workflow YAML file). |
| `agent` | string \| null | no | Override default agent for all tickets in this plan. `null` uses the global default from `orchestrator.yaml`. |
| `worktreeRoot` | string | yes | Absolute path where git worktrees will be created. |
| `status` | `"active"` \| `"paused"` \| `"complete"` | yes | `active` plans are processed by the runner. `paused` plans are skipped. |
| `tickets` | array | yes | Ordered list of ticket entries. |

### Ticket Entry (within `tickets` array)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ticketId` | string | yes | Must match the ticket JSON filename (without `.json`). |
| `order` | number | yes | Execution priority. Lower numbers run first. Ties are broken by the runner. |
| `blockedBy` | string[] | no | Ticket IDs that must reach `complete` before this ticket becomes `ready`. Defaults to `[]`. |

## Ticket State File Schema (`tickets/PROJ-101.json`)

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
  "status": "queued",
  "currentPhase": "setup",
  "phaseHistory": [],
  "context": {},
  "retries": {},
  "error": null
}
```

### Field Reference

**You populate everything above `status`.** The runner owns everything from `status` down.

| Field | Type | You Set? | Description |
|-------|------|----------|-------------|
| `planId` | string | yes | Must match the parent plan's `id`. |
| `ticketId` | string | yes | Unique within the plan. Must match the filename. |
| `title` | string | yes | Short description of the work. |
| `description` | string | yes | Full description for the coding agent. Include enough context for the agent to implement the feature. |
| `acceptanceCriteria` | string[] | yes | List of specific, testable criteria. The agent uses these to know when it's done. Defaults to `[]`. |
| `linearUrl` | string \| null | yes | Link back to the source ticket. `null` if no external source. |
| `repo` | string | yes | Absolute path to the target repo. Overrides the plan-level `repo` when set. Required on every ticket. |
| `workflow` | string | yes | Workflow name. Can override the plan-level `workflow`. |
| `branch` | string | yes | Git branch name. Convention: `<username>/<ticket-id>-<short-slug>`. |
| `worktree` | string | yes | Absolute path for the git worktree. Convention: `<worktreeRoot>/<ticketId>`. |
| `agent` | string \| null | yes | Override agent for this ticket. `null` inherits from plan or global default. |
| `status` | string | set to `"queued"` | Always set new tickets to `"queued"`. The runner promotes them to `"ready"` when dependencies resolve. |
| `currentPhase` | string | set to first phase | Set to the first phase ID in the workflow (typically `"setup"`). |
| `phaseHistory` | array | set to `[]` | Empty. The runner populates this. |
| `context` | object | set to `{}` | Empty. The runner accumulates captured values here. |
| `retries` | object | set to `{}` | Empty. The runner tracks retry counts here. |
| `error` | string \| null | set to `null` | Empty. The runner sets this on failure. |

## Dependency Management

Dependencies are defined in the plan's `tickets[].blockedBy` array:

- A ticket with `"blockedBy": []` (or no blockers) starts as `queued` and becomes `ready` on the first runner tick.
- A ticket with `"blockedBy": ["PROJ-101"]` stays `queued` until PROJ-101 reaches `complete`.
- Dependencies are scoped within a plan. Cross-plan dependencies are not supported.

**Tips:**
- Use `order` for priority within the same dependency tier. Tickets with lower `order` values are picked up first.
- Keep dependency chains short. The runner processes tickets concurrently up to `maxConcurrency`, so independent tickets run in parallel.

## Workflow Selection

Available workflows are discovered automatically from `*.yaml` files in the workflow directory. The workflow directory location is controlled by the `workflowDir` setting in the config file (default: bundled with the package). During interactive sessions, the resolved path is available as `$ORCHESTRATOR_WORKFLOW_DIR` — list the files there to see what's available. See the **Config Skill** (`skills/config/SKILL.md`) for how directory paths are resolved.

Common choices:
- `standard` — Full feature workflow: setup, implement, self-review, simplify, verify, create PR, review cycle, merge, cleanup.
- `bugfix` — Abbreviated workflow for bug fixes. Skips self-review and simplify.

You can override the workflow per-ticket if a specific ticket needs a different flow than the rest of the plan.

## Agent Selection

The agent provider is resolved with a four-level priority chain:
1. **Phase-level** — defined in the workflow YAML
2. **Ticket-level** — the ticket's `agent` field
3. **Plan-level** — the plan's `agent` field
4. **Global default** — `defaultAgent` in the config file

Set `agent` to `null` at the plan or ticket level to inherit from the next level up.

Available agents are defined in the config file under the `agents` key. To see the current config (including which agents are available and what the default is), read `$ORCHESTRATOR_CONFIG_PATH` or see the **Config Skill** (`skills/config/SKILL.md`) for the full schema.

## CLI Commands

```sh
# Scaffold directories and config
orchestrator init

# Check current state
orchestrator status
orchestrator status --plan sprint-12-backend
orchestrator status --json

# Run a single ticket (blocks until done)
orchestrator run <planId> <ticketId>

# Start the daemon (processes all active plans)
orchestrator daemon
orchestrator daemon --concurrency 5

# Intervention commands
orchestrator pause <planId> <ticketId>
orchestrator resume <planId> <ticketId>
orchestrator skip <planId> <ticketId> <phase>
orchestrator retry <planId> <ticketId>
orchestrator pause-plan <planId>
orchestrator resume-plan <planId>
```

## Complete Examples

### Example 1: Sprint Plan from Linear

A backend sprint with three tickets, one depending on another.

**Plan file** (`state/plans/sprint-12-backend/plan.json`):
```json
{
  "id": "sprint-12-backend",
  "name": "Sprint 12 — Backend Team",
  "createdAt": "2026-02-28T10:00:00Z",
  "createdBy": "planner",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "standard",
  "agent": null,
  "worktreeRoot": "/Users/sam/worktrees",
  "status": "active",
  "tickets": [
    { "ticketId": "PROJ-101", "order": 1, "blockedBy": [] },
    { "ticketId": "PROJ-102", "order": 2, "blockedBy": ["PROJ-101"] },
    { "ticketId": "PROJ-103", "order": 1, "blockedBy": [] }
  ]
}
```

**Ticket file** (`state/plans/sprint-12-backend/tickets/PROJ-101.json`):
```json
{
  "planId": "sprint-12-backend",
  "ticketId": "PROJ-101",
  "title": "Add password reset endpoint",
  "description": "Implement POST /api/v1/auth/reset-password that accepts an email address and sends a password reset email with a tokenized link. The token should be a signed JWT with the user's ID and a 24-hour expiry. Store reset tokens in the password_resets table with created_at for expiry tracking. Rate limit to 3 requests per email per hour using the existing rate limiter middleware.",
  "acceptanceCriteria": [
    "POST /api/v1/auth/reset-password accepts { email: string } and returns 202",
    "Sends reset email via the existing email service with a signed JWT link",
    "Token expires after 24 hours",
    "Rate limited to 3 requests per email per hour",
    "Returns 202 even for non-existent emails (no user enumeration)",
    "Tests cover happy path, expiry, and rate limiting"
  ],
  "linearUrl": "https://linear.app/mindbloom/issue/PROJ-101",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "standard",
  "branch": "sam/proj-101-password-reset",
  "worktree": "/Users/sam/worktrees/PROJ-101",
  "agent": null,
  "status": "queued",
  "currentPhase": "setup",
  "phaseHistory": [],
  "context": {},
  "retries": {},
  "error": null
}
```

### Example 2: Hotfix with Codex Agent

A single urgent bug fix using the `bugfix` workflow and Codex as the agent.

**Plan file** (`state/plans/hotfix-auth/plan.json`):
```json
{
  "id": "hotfix-auth",
  "name": "Hotfix — Auth Token Refresh",
  "createdAt": "2026-02-28T14:30:00Z",
  "createdBy": "planner",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "bugfix",
  "agent": "codex",
  "worktreeRoot": "/Users/sam/worktrees",
  "status": "active",
  "tickets": [
    { "ticketId": "PROJ-200", "order": 1, "blockedBy": [] }
  ]
}
```

**Ticket file** (`state/plans/hotfix-auth/tickets/PROJ-200.json`):
```json
{
  "planId": "hotfix-auth",
  "ticketId": "PROJ-200",
  "title": "Fix token refresh returning 401 for valid refresh tokens",
  "description": "The POST /api/v1/auth/refresh endpoint returns 401 for valid refresh tokens when the access token has expired more than 5 minutes ago. Root cause is likely in the token validation middleware which checks the access token expiry before looking at the refresh token. The refresh flow should only validate the refresh token, not the expired access token.",
  "acceptanceCriteria": [
    "POST /api/v1/auth/refresh returns 200 with new tokens when given a valid refresh token, regardless of access token state",
    "Existing tests still pass",
    "New test covers the specific case of expired access token + valid refresh token"
  ],
  "linearUrl": "https://linear.app/mindbloom/issue/PROJ-200",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "bugfix",
  "branch": "sam/proj-200-fix-token-refresh",
  "worktree": "/Users/sam/worktrees/PROJ-200",
  "agent": null,
  "status": "queued",
  "currentPhase": "setup",
  "phaseHistory": [],
  "context": {},
  "retries": {},
  "error": null
}
```

### Example 3: Multi-Repo Mobile Sprint

A plan targeting a different repo with different workflows per ticket.

**Plan file** (`state/plans/mobile-sprint-4/plan.json`):
```json
{
  "id": "mobile-sprint-4",
  "name": "Mobile Sprint 4 — Profile & Settings",
  "createdAt": "2026-02-28T09:00:00Z",
  "createdBy": "planner",
  "repo": "/Users/sam/repos/mindbloom-mobile",
  "workflow": "standard",
  "agent": "claude",
  "worktreeRoot": "/Users/sam/worktrees",
  "status": "active",
  "tickets": [
    { "ticketId": "MOB-50", "order": 1, "blockedBy": [] },
    { "ticketId": "MOB-51", "order": 2, "blockedBy": ["MOB-50"] }
  ]
}
```

### Example 4: Multi-Repo Plan (Backend + Frontend)

A plan that orchestrates work across two repositories. The plan-level `repo` is `null` because tickets target different repos.

**Plan file** (`state/plans/cross-repo-auth/plan.json`):
```json
{
  "id": "cross-repo-auth",
  "name": "Cross-Repo — Auth Overhaul",
  "createdAt": "2026-03-01T10:00:00Z",
  "createdBy": "planner",
  "repo": null,
  "workflow": "standard",
  "agent": null,
  "worktreeRoot": "/Users/sam/worktrees",
  "status": "active",
  "tickets": [
    { "ticketId": "AUTH-1", "order": 1, "blockedBy": [] },
    { "ticketId": "AUTH-2", "order": 2, "blockedBy": ["AUTH-1"] }
  ]
}
```

**Backend ticket** (`state/plans/cross-repo-auth/tickets/AUTH-1.json`):
```json
{
  "planId": "cross-repo-auth",
  "ticketId": "AUTH-1",
  "title": "Add OAuth2 endpoints to backend API",
  "description": "Implement OAuth2 authorization code flow endpoints...",
  "acceptanceCriteria": [
    "GET /api/v1/auth/oauth/authorize redirects to provider",
    "POST /api/v1/auth/oauth/callback exchanges code for tokens"
  ],
  "linearUrl": null,
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "standard",
  "branch": "sam/auth-1-oauth-endpoints",
  "worktree": "/Users/sam/worktrees/AUTH-1",
  "agent": null,
  "status": "queued",
  "currentPhase": "setup",
  "phaseHistory": [],
  "context": {},
  "retries": {},
  "error": null
}
```

**Frontend ticket** (`state/plans/cross-repo-auth/tickets/AUTH-2.json`):
```json
{
  "planId": "cross-repo-auth",
  "ticketId": "AUTH-2",
  "title": "Add OAuth2 login flow to frontend",
  "description": "Implement the OAuth2 login button and callback handler in the frontend app...",
  "acceptanceCriteria": [
    "Login page shows 'Sign in with OAuth' button",
    "Callback page exchanges code and stores session"
  ],
  "linearUrl": null,
  "repo": "/Users/sam/repos/mindbloom-frontend",
  "workflow": "standard",
  "branch": "sam/auth-2-oauth-frontend",
  "worktree": "/Users/sam/worktrees/AUTH-2",
  "agent": null,
  "status": "queued",
  "currentPhase": "setup",
  "phaseHistory": [],
  "context": {},
  "retries": {},
  "error": null
}
```

Key points for multi-repo plans:
- Set plan-level `repo` to `null` when tickets target different repos.
- Each ticket **must** have its own `repo` set to an absolute path.
- `blockedBy` works across repos within the same plan — AUTH-2 waits for AUTH-1 even though they target different repos.
- Each ticket gets its own worktree, branch, and workflow — these are always per-ticket.

## Naming Conventions

- **Plan IDs**: lowercase, hyphenated slugs. Examples: `sprint-12-backend`, `hotfix-auth`, `mobile-sprint-4`.
- **Branch names**: `<username>/<ticket-id>-<short-slug>`. Examples: `sam/proj-101-password-reset`, `sam/mob-50-profile-avatar`.
- **Worktree paths**: `<worktreeRoot>/<ticketId>`. Examples: `/Users/sam/worktrees/PROJ-101`.
- **Ticket IDs**: match the source system's ID format. Keep them uppercase if the source uses uppercase (e.g., `PROJ-101`, `MOB-50`).

## Checklist Before Submitting a Plan

1. Plan `id` matches the directory name.
2. All `ticketId` values in the `tickets` array have matching `.json` files in `tickets/`.
3. `blockedBy` references only ticket IDs that exist in the same plan.
4. Every ticket has an absolute `repo` path pointing to an actual repo. Plan-level `repo` is either an absolute path or `null` for multi-repo plans.
5. `worktreeRoot` is a writable directory.
6. `workflow` names match actual workflow YAML files in the workflow directory.
7. All new tickets have `status: "queued"`, `currentPhase` set to the workflow's first phase, and empty `phaseHistory`, `context`, `retries`.
8. `branch` names are unique across tickets (no two tickets sharing a branch).
