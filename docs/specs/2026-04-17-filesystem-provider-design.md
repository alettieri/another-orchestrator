# Filesystem Issue Provider — Design Spec

**Date:** 2026-04-17
**Status:** Draft
**Supersedes:** `2026-04-17-jira-provider-design.md` (JIRA MCP approach, abandoned)

---

## Overview

Add a filesystem-based issue provider that lets you drop Markdown files into `~/.orchestrator/issues/` and have the orchestrator planner pick them up. A companion conversion script converts JIRA XML exports into that Markdown format.

Two deliverables:
1. **`skills/providers/filesystem/SKILL.md`** — teaches the AI planner how to read issue Markdown files and produce orchestrator plan/ticket state files
2. **`scripts/jira-to-markdown.ts`** + **`scripts/jira-to-markdown.sh`** — converts a JIRA XML RSS export into Markdown issue files

---

## Motivation

The JIRA MCP approach requires a live connection and has an unpredictable tool surface. A filesystem provider is simpler, offline-capable, and works with any source — you can write files by hand, export from JIRA, or generate them from any other tool.

---

## Markdown File Format

Files live at `~/.orchestrator/issues/<key>.md` (e.g. `NJSQ-1287.md`).

```markdown
---
id: NJSQ-1287
title: Update names of things to be consistent / accurate
type: Story
sprint: NJSQ Sprint 2026-08
url: https://productiv.atlassian.net/browse/NJSQ-1287
status: Dev complete
---

## Description

[Markdown content converted from JIRA description]

## Acceptance Criteria

- Criterion extracted from description, or left blank for user to fill in

## Comments

**Comment by Antonio Essex-Lettieri (2026-04-17):**
We need to work on fully removing any trace of evidence...
```

### Frontmatter fields

| Field | Source | Required |
|-------|--------|----------|
| `id` | JIRA `key` | yes |
| `title` | JIRA `summary` | yes |
| `type` | JIRA `type` (Story/Bug/Task/etc.) | yes |
| `sprint` | JIRA custom field `Sprint` (last value) | no |
| `url` | JIRA `link` | no |
| `status` | JIRA `status` | no |

Files can also be created by hand — only `id` and `title` are required.

---

## Conversion Script

### `scripts/jira-to-markdown.ts`

- **Input**: path to a JIRA XML RSS export file (first CLI argument)
- **Output**: one `.md` file per `<item>` written to `~/.orchestrator/issues/`
- **HTML conversion**: uses `turndown` to convert HTML description and comment bodies to Markdown
- **Acceptance Criteria**: extracted from the description if a matching heading is found (`Acceptance Criteria`, `AC`, `Definition of Done`, `Requirements`); otherwise left as an empty section
- **Comments**: all `<comment>` elements appended as a `## Comments` section, each prefixed with author account ID and date (display names are not available in the XML export)
- **Multiple items**: processes all `<item>` elements in one run; the common case is a single item

### `scripts/jira-to-markdown.sh`

Thin bash wrapper:
```sh
#!/bin/bash
tsx "$(dirname "$0")/jira-to-markdown.ts" "$@"
```

Usage:
```sh
./scripts/jira-to-markdown.sh path/to/export.xml
```

---

## Filesystem Provider Skill

### `skills/providers/filesystem/SKILL.md`

Follows the same structure as the Linear and GitHub Issues provider skills. Sections:

1. **Overview** — explain the `~/.orchestrator/issues/` directory, file naming convention
2. **Reading issues** — list `.md` files in the directory, parse frontmatter + body
3. **Field mapping** — Markdown frontmatter → orchestrator ticket state fields
4. **Acceptance criteria** — read from `## Acceptance Criteria` section; derive from `## Description` if absent
5. **Dependency resolution** — parse `## Dependencies` section if present (manual, since filesystem files have no native relation graph); otherwise ask the user
6. **Branch & worktree naming** — same convention as other providers: `<username>/<id-lowercase>-<slug>`
7. **Workflow selection** — `type: Bug` → `bugfix`; all others → `standard`
8. **End-to-end example** — one issue file → `plan.json` + `ticket.json`
9. **Checklist**

### Field mapping

| Markdown field | Orchestrator field | Notes |
|---------------|-------------------|-------|
| `id` (frontmatter) | `ticketId` | e.g. `"NJSQ-1287"` |
| `title` (frontmatter) | `title` | Direct |
| `## Description` body | `description` | Full markdown content |
| `url` (frontmatter) | `linearUrl` | Historical field name, holds any tracker URL |
| `## Acceptance Criteria` | `acceptanceCriteria` | Parsed as list items |
| — | `repo` | Determined from config or user input |
| — | `branch` | Generated from id + title slug |
| — | `worktree` | Generated from `worktreeRoot` + id |

---

## Scope

**In scope:**
- Conversion script (TypeScript + bash wrapper)
- Filesystem provider SKILL.md
- `~/.orchestrator/issues/` as the issue directory (alongside existing `state/` dir)

**Out of scope:**
- Changes to `orchestrator init` to create the `issues/` directory (can be done manually for now)
- Writeback to JIRA
- Watching the directory for changes
- Sub-tasks (excluded from JIRA XML export via the export filter, or ignored by the planner)
