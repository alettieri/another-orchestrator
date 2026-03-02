---
description: Fetch issues from GitHub and create orchestrator state files
---

# GitHub Issues Provider Skill

This skill teaches you how to fetch issues from GitHub and create orchestrator plan and ticket state files from them.

## Fetching Issues with `gh` CLI

Use the `gh` CLI to query GitHub Issues.

### List Issues for a Repository

```sh
# All open issues
gh issue list --repo owner/repo --state open --json number,title,body,labels,assignees,milestone

# Filter by milestone
gh issue list --repo owner/repo --milestone "Sprint 12" --json number,title,body,labels,assignees,milestone

# Filter by label
gh issue list --repo owner/repo --label "feature" --json number,title,body,labels,assignees,milestone
```

### Get a Single Issue

```sh
gh issue view 101 --repo owner/repo --json number,title,body,labels,assignees,milestone,comments
```

### List Milestones

```sh
gh api repos/owner/repo/milestones --jq '.[].title'
```

## Field Mapping

Map GitHub Issue fields to orchestrator ticket state fields:

| GitHub Field | Orchestrator Field | Notes |
|-------------|-------------------|-------|
| `number` | `ticketId` | Prefix with repo short name, e.g., `"GH-101"` |
| `title` | `title` | Direct mapping |
| `body` | `description` | Markdown body. Expand with context if too terse. |
| Issue URL | `linearUrl` | Use the full GitHub issue URL (field works for any URL, not just Linear) |
| — | `acceptanceCriteria` | Extract from the body (see below) |
| — | `repo` | The local clone path for this repository |
| — | `branch` | Generate: `<username>/<ticketId>-<slug>` |
| — | `worktree` | Generate: `<worktreeRoot>/<ticketId>` |

### Ticket ID Convention

GitHub issues are just numbers. Prefix them with a short repo identifier to make them unique across repos:

- `mindbloom-backend` issue #101 → `"GH-101"` or `"MB-101"`
- `mindbloom-mobile` issue #50 → `"MOB-50"`

Pick a short prefix and use it consistently within a plan.

### Extracting Acceptance Criteria

GitHub issue templates often include structured sections. Look for:

1. **Task lists**: `- [ ] criterion` (most common in GitHub)
2. **Sections**: Headers like "## Acceptance Criteria", "## Requirements", "## Definition of Done"
3. **Numbered lists** under a criteria heading

If the issue uses a template with structured sections, parse each section.

If no explicit criteria exist, derive them from the body:
- Each distinct requirement becomes a criterion
- Each behavioral expectation becomes a criterion
- Add "Existing tests still pass" as a default criterion

### Example Extraction

**GitHub issue body:**
```markdown
## Description
Add a new endpoint for user preferences.

## Requirements
- [ ] GET /api/v1/preferences returns current preferences
- [ ] PATCH /api/v1/preferences updates specific fields
- [ ] Validate preference values against allowed options
- [ ] Add integration tests

## Notes
Preferences schema is in `docs/preferences.md`.
```

**Extracted:**
```json
"acceptanceCriteria": [
  "GET /api/v1/preferences returns current preferences",
  "PATCH /api/v1/preferences updates specific fields",
  "Validate preference values against allowed options",
  "Add integration tests"
]
```

**Description** (combine Description + Notes for richer context):
```json
"description": "Add a new endpoint for user preferences.\n\nGET /api/v1/preferences returns current preferences. PATCH /api/v1/preferences updates specific fields. Validate preference values against allowed options.\n\nPreferences schema is in docs/preferences.md."
```

## Dependency Resolution

GitHub Issues don't have first-class dependency relations. Infer them from:

### 1. Issue References in Body

Look for patterns like:
- "Depends on #42" / "Blocked by #42"
- "After #42 is merged"
- "Requires #42"

### 2. Issue Comments

Check for comments that mention blocking relationships.

### 3. Labels

Some projects use labels like `blocked` or `depends-on:42`.

### 4. Manual Input

When dependencies aren't clear from the issues, ask the human to specify them.

### Mapping

```json
"tickets": [
  { "ticketId": "GH-101", "order": 1, "blockedBy": [] },
  { "ticketId": "GH-102", "order": 2, "blockedBy": ["GH-101"] }
]
```

Only include dependencies for issues within the same plan.

## Branch Naming

Convention: `<username>/<ticketId-lowercase>-<slug>`

Generate the slug from the title:
1. Lowercase the title
2. Replace spaces and special characters with hyphens
3. Truncate to ~40 characters
4. Remove trailing hyphens

Examples:
- GH-101 "Add user preferences endpoint" → `sam/gh-101-add-user-preferences-endpoint`
- GH-55 "Fix login redirect loop" → `sam/gh-55-fix-login-redirect-loop`

## Workflow Selection

Choose based on GitHub Issue labels:

| GitHub Signal | Workflow |
|--------------|----------|
| Label: `bug`, `hotfix` | `bugfix` |
| Label: `feature`, `enhancement`, or no label | `standard` |

Check `workflows/registry.yaml` for available workflows and their descriptions.

## Example: Milestone to Plan

Given a GitHub milestone "v2.1" in repo `mindbloom/backend` with these issues:

1. #101 "Add user preferences endpoint" (label: feature)
2. #102 "Preferences UI integration" (label: feature, body says "Depends on #101")
3. #103 "Fix timezone display in dashboard" (label: bug)

### Step 1: Fetch Issues

```sh
gh issue list --repo mindbloom/backend --milestone "v2.1" --json number,title,body,labels
```

### Step 2: Create Plan

```json
{
  "id": "v2-1-backend",
  "name": "v2.1 — Backend Milestone",
  "createdAt": "2026-02-28T10:00:00Z",
  "createdBy": "planner",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "standard",
  "agent": null,
  "worktreeRoot": "/Users/sam/worktrees",
  "status": "active",
  "tickets": [
    { "ticketId": "GH-101", "order": 1, "blockedBy": [] },
    { "ticketId": "GH-102", "order": 2, "blockedBy": ["GH-101"] },
    { "ticketId": "GH-103", "order": 1, "blockedBy": [] }
  ]
}
```

Note: GH-103 uses `"workflow": "bugfix"` at the ticket level since it's a bug fix, while the plan defaults to `standard`.

### Step 3: Create Ticket Files

**`state/plans/v2-1-backend/tickets/GH-103.json`** (bug fix with workflow override):
```json
{
  "planId": "v2-1-backend",
  "ticketId": "GH-103",
  "title": "Fix timezone display in dashboard",
  "description": "The dashboard shows UTC times instead of the user's local timezone. The timezone preference is stored in user.settings.timezone but the dashboard component doesn't apply it when formatting dates.",
  "acceptanceCriteria": [
    "Dashboard displays times in the user's configured timezone",
    "Falls back to UTC if no timezone is set",
    "Existing tests still pass"
  ],
  "linearUrl": "https://github.com/mindbloom/backend/issues/103",
  "repo": "/Users/sam/repos/mindbloom-backend",
  "workflow": "bugfix",
  "branch": "sam/gh-103-fix-timezone-display",
  "worktree": "/Users/sam/worktrees/GH-103",
  "agent": null,
  "status": "queued",
  "currentPhase": "setup",
  "phaseHistory": [],
  "context": {},
  "retries": {},
  "error": null
}
```

### Step 4: Verify

```sh
orchestrator status --plan v2-1-backend
```

## Checklist

1. All issues in the milestone are accounted for.
2. Ticket IDs use a consistent prefix (e.g., `GH-` or a repo-specific short code).
3. Dependencies inferred from issue body references are correctly mapped to `blockedBy`.
4. Acceptance criteria are extracted from task lists, requirement sections, or derived from the body.
5. Bug issues use the `bugfix` workflow (override at ticket level if plan defaults to `standard`).
6. Branch names are unique and follow the naming convention.
7. The `linearUrl` field contains the GitHub issue URL (the field name is historical — it works for any URL).
