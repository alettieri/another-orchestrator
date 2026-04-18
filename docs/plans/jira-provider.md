# Plan: JIRA Provider Skill

> Source PRD: `docs/specs/2026-04-17-jira-provider-design.md`

## Architectural decisions

- **Deliverable**: single file `skills/providers/jira/SKILL.md` + `skills/providers/jira/.gitkeep`
- **No source code changes**: this is a skill document only, following the same pattern as `skills/providers/linear/SKILL.md` and `skills/providers/github-issues/SKILL.md`
- **Integration approach**: runtime MCP tool discovery (planner lists available tools, filters for JIRA ones, adapts to what's present)
- **Grouping unit**: JIRA Sprint (not Epic or Fix Version)
- **Sub-tasks**: excluded from plans — rolled up into parent issues, not created as separate tickets
- **Ticket ID format**: JIRA key as-is (e.g. `PROJ-101`)
- **Issue URL field**: stored in `linearUrl` (historical field name — holds any tracker URL, same as GitHub provider)

---

## Phase 1: Core skill scaffold
**Status**: pending

**User stories**: Planner can open the JIRA provider skill and understand how to connect to JIRA and pull a sprint's issues into orchestrator state.

### What to build

Create the `skills/providers/jira/` directory with a `.gitkeep` and the `SKILL.md` file containing:
- Frontmatter with description
- Introduction explaining the skill's purpose
- **MCP Tool Discovery** section: how to list available tools, filter for JIRA ones, and identify tools for searching issues, getting a single issue, listing boards, and listing sprints. Includes a table of expected tool name patterns and a JQL fallback if sprint listing isn't available.
- **Fetching a Sprint** section: step-by-step instructions to locate a board, find the sprint by name (or use active sprint), and fetch all issues excluding Sub-tasks.
- **Field Mapping** table: JIRA fields → orchestrator ticket fields (`key`, `summary`, `description`, issue URL → `linearUrl`, plus generated fields for `branch`, `worktree`).

### Acceptance criteria

- [ ] `skills/providers/jira/.gitkeep` exists
- [ ] `skills/providers/jira/SKILL.md` exists with valid frontmatter
- [ ] Discovery section instructs the planner to list and filter MCP tools
- [ ] Discovery section includes a table of expected tool name patterns
- [ ] Discovery section includes a JQL fallback for sprint queries
- [ ] Fetching section covers: locate board, find sprint by name, filter out Sub-tasks
- [ ] Field mapping table covers all required orchestrator ticket fields

#### Tasks

1. **Create directory scaffold**

   Create `skills/providers/jira/.gitkeep` to match the existing provider directory pattern.

   #### Acceptance criteria
   - [ ] File exists at `skills/providers/jira/.gitkeep`

2. **Write SKILL.md — frontmatter, intro, discovery section**

   Add frontmatter (`description`), a short intro paragraph, and the full MCP Tool Discovery section including the tool name pattern table and JQL fallback.

   #### Acceptance criteria
   - [ ] Frontmatter present with `description` field
   - [ ] Discovery section guides the planner to filter tools by `jira` name
   - [ ] Tool pattern table covers search, get-issue, list-boards, list-sprints
   - [ ] JQL fallback documented for when sprint listing tool is absent

3. **Write SKILL.md — fetching and field mapping sections**

   Add the Fetching a Sprint section (step-by-step) and the Field Mapping table.

   #### Acceptance criteria
   - [ ] Fetching section lists all steps: find board → find sprint → fetch issues → filter sub-tasks
   - [ ] Active sprint fallback documented (when no sprint name given)
   - [ ] Field mapping covers: `key`, `summary`, `description` (with ADF note), issue URL, `acceptanceCriteria`, `repo`, `branch`, `worktree`

---

## Phase 2: Complete the skill
**Status**: pending

**User stories**: Planner can fully convert a JIRA sprint into a valid orchestrator plan, including acceptance criteria, dependencies, branch names, workflow selection, with a concrete end-to-end example to reference.

### What to build

Extend `SKILL.md` with the remaining sections that complete the field-to-state transformation:
- **Acceptance Criteria Extraction**: how to find explicit AC sections, checkbox lists, numbered lists, and how to derive criteria when none exist.
- **Dependency Resolution**: mapping JIRA `blocks`/`is blocked by` links to `blockedBy` arrays; handling cross-plan dependencies.
- **Branch & Worktree Naming**: slug generation rules and examples.
- **Workflow Selection**: issue type / label → workflow name table.
- **End-to-end Example**: a complete sprint-to-plan walkthrough with sample `plan.json` and one ticket JSON.
- **Checklist**: final verification steps the planner should run before handing off to the runner.
- **Update Path** note: what to do once specific MCP tool names are confirmed.

### Acceptance criteria

- [ ] Acceptance criteria extraction covers: explicit sections, checkbox lists, numbered lists, derived fallback
- [ ] Dependency resolution maps `is blocked by` and `blocks` link types; `relates to`/`duplicates` are skipped
- [ ] Cross-plan dependency handling documented
- [ ] Branch naming convention matches other providers (`<username>/<key-lowercase>-<slug>`)
- [ ] Workflow selection table covers Bug → bugfix, Story/Task/Epic → standard, hotfix label → bugfix
- [ ] End-to-end example includes plan.json and at least one complete ticket JSON
- [ ] Checklist covers all verification steps (sub-task exclusion, ticket IDs, dependencies, AC, workflow, branch names, linearUrl, repo path, `orchestrator status`)
- [ ] Update path note explains how to harden the skill once tool names are known

#### Tasks

1. **Write acceptance criteria extraction section**

   Document how to locate AC in JIRA descriptions (explicit headers, checkboxes, numbered lists) and derive them when absent. Mirror the depth of the Linear provider's equivalent section.

   #### Acceptance criteria
   - [ ] Covers explicit section headers (AC, Acceptance Criteria, Definition of Done, Requirements)
   - [ ] Covers `- [ ]` checkbox patterns
   - [ ] Covers derived fallback with "Existing tests still pass" default

2. **Write dependency resolution section**

   Document mapping of JIRA issue link types to `blockedBy`. Include guidance on cross-plan dependencies.

   #### Acceptance criteria
   - [ ] `is blocked by` → add to `blockedBy`
   - [ ] `blocks` → add this key to the other ticket's `blockedBy`
   - [ ] `relates to` and `duplicates` documented as skip
   - [ ] Cross-plan note matches the pattern in the Linear provider

3. **Write branch naming, workflow selection, example, checklist, and update path**

   Add the remaining sections to complete the skill. The end-to-end example should use the same fictional sprint from the design spec (PROJ-101/102/103) for consistency with the spec.

   #### Acceptance criteria
   - [ ] Branch naming examples use `<username>/proj-NNN-<slug>` format
   - [ ] Workflow table covers Bug, Story/Task/Epic, and hotfix label
   - [ ] Example plan.json is valid against the orchestrator plan schema
   - [ ] Example ticket JSON is complete (all required fields present)
   - [ ] Checklist has 9 items matching the design spec
   - [ ] Update path section present at end of file
