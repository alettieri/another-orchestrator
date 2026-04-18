# Plan: JIRA Provider Skill

> Source spec: docs/specs/2026-04-17-jira-provider-design.md

## Architectural decisions

- **Deliverable**: single file `skills/providers/jira/SKILL.md` + `.gitkeep`. No source code changes.
- **MCP server**: `atlassian-rovo-mcp` (configured in `.mcp.json`), exposing two tools:
  - `mcp__atlassian__getTeamworkGraphObject` — bulk-fetch up to 25 issues by URL or ARI
  - `mcp__atlassian__getTeamworkGraphContext` — fetch relationship graph for a single issue (linked issues, sprints, etc.)
- **Sprint listing**: these tools are graph/relationship tools, not JQL search. The planner seeds the fetch by asking the user for issue keys/URLs, then bulk-fetches via `getTeamworkGraphObject`.
- **Dependency resolution**: `getTeamworkGraphContext` with `relationshipTypes` filtered to issue links.
- **Field name**: JIRA issue URL stored in the `linearUrl` ticket field (historical name, same as GitHub provider).

---

## Phase 1: Core skill scaffold
**Status**: pending

**Covers**: directory structure, frontmatter, tool overview, fetching sprint issues, field mapping table.

### What to build

Create `skills/providers/jira/SKILL.md` (and `.gitkeep`) with the skill frontmatter and the first three sections: an overview of the two MCP tools, how to seed and bulk-fetch sprint issues, and the JIRA→orchestrator field mapping table.

### Acceptance criteria

- [ ] `skills/providers/jira/.gitkeep` exists
- [ ] `skills/providers/jira/SKILL.md` exists with correct frontmatter
- [ ] Skill includes MCP tool overview section with both tool names, purposes, and parameters
- [ ] Skill explains how to ask the user for issue keys/URLs and seed the fetch
- [ ] Skill shows how to call `getTeamworkGraphObject` to bulk-fetch issues (batches of ≤25)
- [ ] Field mapping table covers all required orchestrator fields

#### Tasks

1. **Create directory and .gitkeep**

   Mirror the pattern of `skills/providers/linear/` and `skills/providers/github-issues/`.

   #### Acceptance criteria
   - [ ] `skills/providers/jira/.gitkeep` created

2. **Write SKILL.md frontmatter and MCP tool overview**

   Include `description` frontmatter. Document both MCP tools with their purpose, key parameters (`cloudId`, `objects`/`objectIdentifier`), and the MCP server instruction (do not use for basic CRUD).

   #### Acceptance criteria
   - [ ] Frontmatter `description` matches the pattern of other providers
   - [ ] Both tools documented with purpose and key parameters

3. **Write fetching section**

   Explain: (1) ask user for project key + sprint name and issue keys/URLs; (2) bulk-fetch in batches of ≤25 via `getTeamworkGraphObject`; (3) note cloudId can be the site URL (e.g. `yourcompany.atlassian.net`).

   #### Acceptance criteria
   - [ ] Batching constraint (≤25) documented
   - [ ] cloudId format explained

4. **Write field mapping table**

   Map all JIRA fields to orchestrator ticket fields, including the `linearUrl` note.

   #### Acceptance criteria
   - [ ] All 8 orchestrator fields covered in the mapping table

---

## Phase 2: Complete the skill
**Status**: pending

**Covers**: acceptance criteria extraction, dependency resolution, branch/worktree naming, workflow selection, end-to-end example, checklist, update path note.

### What to build

Complete `skills/providers/jira/SKILL.md` with the remaining sections needed to take the planner from raw JIRA data to finished orchestrator state files.

### Acceptance criteria

- [ ] Acceptance criteria extraction section with examples
- [ ] Dependency resolution using `getTeamworkGraphContext` with `relationshipTypes` filter
- [ ] Branch and worktree naming convention with examples
- [ ] Workflow selection table (issue type → workflow name)
- [ ] End-to-end example: sprint → `plan.json` + one `ticket.json`
- [ ] Checklist section matching the pattern of other providers

#### Tasks

1. **Write acceptance criteria extraction section**

   Document the four lookup patterns (explicit headers, checkboxes, numbered lists, derived). Include a before/after example matching the style of the Linear skill.

   #### Acceptance criteria
   - [ ] Four extraction patterns documented
   - [ ] Before/after example present

2. **Write dependency resolution section**

   Show how to call `getTeamworkGraphContext` on each issue with `objectType: "JiraWorkItem"` and filter `relationshipTypes` to issue links. Map `blocks`/`is blocked by` to `blockedBy` array. Note cross-plan dependencies go in the description.

   #### Acceptance criteria
   - [ ] `getTeamworkGraphContext` call shown with correct parameters
   - [ ] Link type mapping table present

3. **Write branch naming and workflow selection sections**

   Branch convention `<username>/<key-lowercase>-<slug>` with slug rules and two examples. Workflow table: Bug → bugfix, Story/Task/Epic → standard, hotfix label → bugfix.

   #### Acceptance criteria
   - [ ] Two branch name examples
   - [ ] Workflow table with all covered issue types

4. **Write end-to-end example**

   Three-issue sprint example producing `plan.json` and one `ticket.json` (the bug). Match the structure of the Linear and GitHub provider examples exactly.

   #### Acceptance criteria
   - [ ] `plan.json` JSON block present and valid
   - [ ] One `ticket.json` JSON block present and valid
   - [ ] Bug ticket uses `bugfix` workflow override

5. **Write checklist section**

   9-item checklist matching the pattern of other providers. Include the `orchestrator status` verification step.

   #### Acceptance criteria
   - [ ] 9 checklist items present
   - [ ] `orchestrator status` command included
