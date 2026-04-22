---
name: filesystem
description: Read issue Markdown files from ~/.orchestrator/issues/ and create orchestrator state files
---

# Filesystem Issue Provider Skill

This skill teaches you how to read issue Markdown files from `~/.orchestrator/issues/` and create orchestrator plan and ticket state files from them.

## Overview

Issue files live at `~/.orchestrator/issues/<key>.md`. Each file has YAML frontmatter and structured body sections:

```markdown
---
id: NJSQ-1287
title: "Update names of things to be consistent / accurate"
type: Story
sprint: "NJSQ Sprint 2026-08"
url: https://productiv.atlassian.net/browse/NJSQ-1287
status: "Dev complete"
---

## Description

...

## Acceptance Criteria

- Criterion one
- Criterion two

## Comments

**author-id** (date)

Comment body...
```

Only `id` and `title` are required. Files created by hand can omit the other frontmatter fields.

## Reading Issues

List all `.md` files in `~/.orchestrator/issues/`:

```
ls ~/.orchestrator/issues/*.md
```

Read each file and parse:
1. YAML frontmatter between the `---` delimiters
2. `## Description` section body
3. `## Acceptance Criteria` section body
4. `## Comments` section body (optional)
5. `## Dependencies` section body (optional — see Dependency Resolution)

## Field Mapping

Map Markdown file fields to orchestrator ticket state fields:

| Markdown Field | Orchestrator Field | Notes |
|---------------|-------------------|-------|
| `id` (frontmatter) | `ticketId` | e.g., `"NJSQ-1287"` |
| `title` (frontmatter) | `title` | Direct mapping |
| `## Description` body | `description` | Full Markdown content |
| `url` (frontmatter) | `linearUrl` | Any tracker URL. Field name is historical. |
| `## Acceptance Criteria` | `acceptanceCriteria` | Parsed as array of list items (see below) |
| — | `repo` | Determined from config or ask the user |
| — | `branch` | Generated: `<username>/<id-lowercase>-<slug>` |
| — | `worktree` | Generated: `<worktreeRoot>/<id>` |

## Acceptance Criteria Extraction

Read the `## Acceptance Criteria` section and parse each list item as a criterion:

```markdown
## Acceptance Criteria

- POST /api/v1/auth/reset-password accepts email
- Sends reset email with tokenized link
- Token expires after 24 hours
```

Produces:
```json
"acceptanceCriteria": [
  "POST /api/v1/auth/reset-password accepts email",
  "Sends reset email with tokenized link",
  "Token expires after 24 hours"
]
```

If the section is empty or absent, derive criteria from the `## Description` body:
- Each distinct requirement → one criterion
- Each behavioral expectation → one criterion
- Always add `"Existing tests still pass"` as a default criterion

## Dependency Resolution

Issue Markdown files don't have a native relation graph. Resolve dependencies in this order:

### 1. `## Dependencies` Section

If the file has a `## Dependencies` section, parse issue IDs listed there:

```markdown
## Dependencies

- NJSQ-1200
- NJSQ-1201
```

Map each to the `blockedBy` array.

### 2. Body References

Look for patterns like "Depends on NJSQ-1200", "Blocked by NJSQ-1200", "After NJSQ-1200".

### 3. Ask the User

If dependencies aren't clear from the files, ask the user to specify them.

Only include dependencies for issues within the same plan.

## Branch & Worktree Naming

Convention: `<username>/<id-lowercase>-<slug>`

Slug generation:
1. Lowercase the title
2. Replace spaces and special characters with hyphens
3. Truncate to ~40 characters
4. Remove trailing hyphens

Examples:
- `NJSQ-1287` "Update names of things to be consistent" → `sam/njsq-1287-update-names-of-things-to-be-consis`
- `NJSQ-55` "Fix login redirect loop" → `sam/njsq-55-fix-login-redirect-loop`

## Workflow Selection

| Signal | Workflow |
|--------|----------|
| `type: Bug` (frontmatter) | `bugfix` |
| `type: Story`, `Task`, `Epic`, or absent | `standard` |
| `type` contains `hotfix` | `bugfix` |

List the workflow YAML files in the workflow directory to see all available workflows and their descriptions.

## End-to-End Example

Given two issue files in `~/.orchestrator/issues/`:

- `NJSQ-1287.md` (Story, no dependencies)
- `NJSQ-1288.md` (Bug, depends on NJSQ-1287)

### Step 1: Determine Plan Metadata

```json
{
  "id": "njsq-sprint-2026-08",
  "name": "NJSQ Sprint 2026-08",
  "createdAt": "2026-04-17T10:00:00Z",
  "createdBy": "planner",
  "repo": "/Users/sam/repos/productiv-backend",
  "workflow": "standard",
  "agent": null,
  "worktreeRoot": "/Users/sam/worktrees",
  "status": "active",
  "tickets": [
    { "ticketId": "NJSQ-1287", "order": 1, "blockedBy": [] },
    { "ticketId": "NJSQ-1288", "order": 2, "blockedBy": ["NJSQ-1287"] }
  ]
}
```

### Step 2: Create Ticket State Files

**`tickets/NJSQ-1288.json`** (bug fix with workflow override):
```json
{
  "planId": "njsq-sprint-2026-08",
  "ticketId": "NJSQ-1288",
  "title": "Fix login redirect loop",
  "description": "After successful login, users are redirected back to /login instead of /dashboard.",
  "acceptanceCriteria": [
    "Successful login redirects to /dashboard by default",
    "If a valid returnTo param is present, redirect there instead",
    "Existing tests still pass"
  ],
  "linearUrl": "https://productiv.atlassian.net/browse/NJSQ-1288",
  "repo": "/Users/sam/repos/productiv-backend",
  "workflow": "bugfix",
  "branch": "sam/njsq-1288-fix-login-redirect-loop",
  "worktree": "/Users/sam/worktrees/NJSQ-1288",
  "agent": null,
  "status": "queued",
  "currentPhase": "setup",
  "phaseHistory": [],
  "context": {},
  "retries": {},
  "error": null
}
```

### Step 3: Verify

```sh
orchestrator status --plan njsq-sprint-2026-08
```

## Checklist

1. All issue files in `~/.orchestrator/issues/` that belong to this plan are accounted for.
2. Ticket IDs match the `id` frontmatter field and the filename (without `.json`).
3. Dependencies from `## Dependencies` sections or body references are correctly mapped to `blockedBy`.
4. Acceptance criteria are extracted or derived for every ticket.
5. Bug issues use the `bugfix` workflow (override at ticket level if the plan defaults to `standard`).
6. Branch names are unique and follow the naming convention.
7. The `linearUrl` field contains the issue URL (or is omitted if no URL is available).
8. The `repo` path is correct for this project.
9. Run `orchestrator status --plan <plan-id>` to confirm the plan and tickets are valid.
