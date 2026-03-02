---
description: Fetch tickets from Linear and create orchestrator state files
---

# Linear Provider Skill

This skill teaches you how to fetch tickets from Linear and create orchestrator plan and ticket state files from them.

## Fetching Tickets from Linear

Use the Linear MCP tools or API to fetch issues. Common operations:

### List Issues for a Project or Cycle

```
Use mcp__linear__list_issues to fetch issues filtered by:
- team
- project
- cycle
- status (e.g., "Todo", "In Progress")
- assignee
- label
```

### Get a Single Issue

```
Use mcp__linear__get_issue with the issue identifier (e.g., "PROJ-101")
```

### Get Project Details

```
Use mcp__linear__get_project to understand the project context, timeline, and goals.
```

## Field Mapping

Map Linear issue fields to orchestrator ticket state fields:

| Linear Field | Orchestrator Field | Notes |
|-------------|-------------------|-------|
| `identifier` | `ticketId` | e.g., `"PROJ-101"` |
| `title` | `title` | Direct mapping |
| `description` | `description` | Markdown body. Expand with context if too terse. |
| `url` | `linearUrl` | Full Linear URL for the issue |
| — | `acceptanceCriteria` | Extract from the description (see below) |
| — | `repo` | Determine from the team or project context |
| — | `branch` | Generate: `<username>/<identifier>-<slug>` |
| — | `worktree` | Generate: `<worktreeRoot>/<identifier>` |

### Extracting Acceptance Criteria

Linear descriptions often include acceptance criteria in various formats. Look for:

1. **Explicit sections**: Headers like "Acceptance Criteria", "AC", "Definition of Done"
2. **Checkbox lists**: `- [ ] criterion` patterns
3. **Numbered lists** under a criteria heading

If no explicit criteria exist, derive them from the description:
- Each distinct requirement becomes a criterion
- Each behavioral expectation becomes a criterion
- Add "Existing tests still pass" as a default criterion

### Example Extraction

**Linear description:**
```markdown
Implement the password reset flow.

## Acceptance Criteria
- [ ] POST /api/v1/auth/reset-password accepts email
- [ ] Sends reset email with tokenized link
- [ ] Token expires after 24 hours
- [ ] Rate limited to 3/hour per email
```

**Extracted:**
```json
"acceptanceCriteria": [
  "POST /api/v1/auth/reset-password accepts email",
  "Sends reset email with tokenized link",
  "Token expires after 24 hours",
  "Rate limited to 3/hour per email"
]
```

## Dependency Resolution

Linear supports issue relations. Map them to `blockedBy` arrays:

| Linear Relation | Orchestrator Mapping |
|----------------|---------------------|
| "is blocked by" | Add the blocker's `identifier` to `blockedBy` |
| "blocks" | Add this ticket's `identifier` to the blocked ticket's `blockedBy` |
| "relates to" | No dependency — informational only |
| "duplicate of" | Skip the duplicate issue entirely |
| Sub-issues | Parent blocks children by default, unless they're independent |

### Resolving Relations

```
Use mcp__linear__get_issue to fetch each issue's relations.
For each "is blocked by" relation, add the blocking issue's identifier to blockedBy.
```

Only include dependencies for issues that are in the same plan. Cross-plan dependencies are not supported — if an issue depends on something outside the plan, note it in the ticket description instead.

## Branch Naming

Convention: `<username>/<identifier-lowercase>-<slug>`

Generate the slug from the title:
1. Lowercase the title
2. Replace spaces and special characters with hyphens
3. Truncate to ~40 characters
4. Remove trailing hyphens

Examples:
- "Add password reset endpoint" → `sam/proj-101-add-password-reset-endpoint`
- "Fix auth token refresh 401" → `sam/proj-200-fix-auth-token-refresh-401`

## Workflow Selection

Choose based on Linear issue labels and type:

| Linear Signal | Workflow |
|--------------|----------|
| Label: `bug`, `hotfix` | `bugfix` |
| Label: `feature`, or no label | `standard` |
| Priority: Urgent + Label: `bug` | `bugfix` |

Check `workflows/registry.yaml` for available workflows and their descriptions.

## Example: Sprint to Plan

Given a Linear cycle "Sprint 12" for team "Backend" with these issues:

1. PROJ-101 "Add password reset endpoint" (Todo, no blockers)
2. PROJ-102 "Add password reset UI" (Todo, blocked by PROJ-101)
3. PROJ-103 "Update user preferences API" (Todo, no blockers)

### Step 1: Determine Plan Metadata

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
  "status": "active"
}
```

### Step 2: Build Ticket List with Dependencies

```json
"tickets": [
  { "ticketId": "PROJ-101", "order": 1, "blockedBy": [] },
  { "ticketId": "PROJ-102", "order": 2, "blockedBy": ["PROJ-101"] },
  { "ticketId": "PROJ-103", "order": 1, "blockedBy": [] }
]
```

PROJ-101 and PROJ-103 run in parallel (both order 1, no blockers). PROJ-102 waits for PROJ-101.

### Step 3: Create Ticket State Files

For each issue, fetch the full details and create a ticket JSON in `state/plans/sprint-12-backend/tickets/`.

### Step 4: Verify

Run `orchestrator status --plan sprint-12-backend` to confirm the plan and tickets are valid.

## Checklist

1. All issues in the sprint/cycle are accounted for.
2. Dependencies from Linear relations are correctly mapped to `blockedBy`.
3. Acceptance criteria are extracted or derived for every ticket.
4. Branch names are unique and follow the naming convention.
5. The repo path is correct for the team/project.
6. Workflow selection matches the issue type/labels.
