# Plan: Filesystem Issue Provider

> Source PRD: docs/specs/2026-04-17-filesystem-provider-design.md

## Architectural decisions

- **Issue directory**: `~/.orchestrator/issues/<key>.md` (alongside existing `state/` dir)
- **Markdown format**: YAML frontmatter (`id`, `title`, `type`, `sprint`, `url`, `status`) + `## Description`, `## Acceptance Criteria`, `## Comments` body sections
- **HTML conversion**: `turndown` npm package
- **Script entry**: `scripts/jira-to-markdown.ts` invoked via `scripts/jira-to-markdown.sh`
- **Provider skill**: follows Linear/GitHub Issues provider pattern in `skills/providers/`

---

## Phase 1: JIRA XML to Markdown conversion script
**Status**: pending

**Covers**: Parse JIRA XML RSS export, convert HTML fields to Markdown, write one `.md` file per issue to `~/.orchestrator/issues/`.

### What to build

A TypeScript script that takes a JIRA XML export file path as its first argument, parses all `<item>` elements, converts HTML description and comment bodies to Markdown using `turndown`, extracts acceptance criteria from the description if a matching heading is found, and writes one `<key>.md` file per issue to `~/.orchestrator/issues/`. A bash wrapper invokes the script via `tsx`.

### Acceptance criteria

- [ ] `turndown` and `@types/turndown` added to `package.json` dependencies
- [ ] `scripts/jira-to-markdown.ts` parses all `<item>` elements from the XML
- [ ] HTML descriptions are converted to Markdown
- [ ] Frontmatter includes `id`, `title`, `type`, `sprint` (last sprint value), `url`, `status`
- [ ] `## Acceptance Criteria` section extracted from description if heading found, otherwise empty placeholder
- [ ] `## Comments` section includes all comments with author ID and date
- [ ] Output files written to `~/.orchestrator/issues/<key>.md`
- [ ] `scripts/jira-to-markdown.sh` bash wrapper works end-to-end
- [ ] Running the script against the sample XML produces a valid `.md` file

#### Tasks

1. **Add turndown dependency**

   Add `turndown` and `@types/turndown` to `package.json`. Run `pnpm install`.

   #### Acceptance criteria
   - [ ] `turndown` present in `package.json` dependencies
   - [ ] `pnpm install` succeeds

2. **Implement jira-to-markdown.ts**

   Parse the XML with Node's built-in `fs` + a lightweight XML parser or regex (the structure is simple enough). For each `<item>`: extract frontmatter fields, convert `<description>` and `<comment>` HTML to Markdown via `turndown`, extract AC from description, write output file.

   #### Acceptance criteria
   - [ ] Parses `key`, `summary`, `type`, `link`, `status`, sprint custom field, comments
   - [ ] `turndown` converts HTML to clean Markdown
   - [ ] Acceptance criteria extracted when heading present in description
   - [ ] Output file matches the format in the design spec
   - [ ] Handles multiple `<item>` elements in one file

3. **Add jira-to-markdown.sh bash wrapper**

   Single-line wrapper: `tsx "$(dirname "$0")/jira-to-markdown.ts" "$@"`.

   #### Acceptance criteria
   - [ ] Script is executable (`chmod +x`)
   - [ ] Passes all arguments through to the TypeScript script

---

## Phase 2: Filesystem provider skill
**Status**: pending

**Covers**: `skills/providers/filesystem/SKILL.md` teaching the planner to read issue Markdown files and produce orchestrator plan/ticket state files.

### What to build

A SKILL.md following the exact structure of the Linear and GitHub Issues provider skills. Covers all nine sections needed to take the planner from raw `.md` files in `~/.orchestrator/issues/` to finished `plan.json` + `ticket/*.json` state files.

### Acceptance criteria

- [ ] `skills/providers/filesystem/.gitkeep` exists
- [ ] `skills/providers/filesystem/SKILL.md` exists with correct frontmatter
- [ ] All nine sections present: overview, reading issues, field mapping, AC extraction, dependency resolution, branch naming, workflow selection, end-to-end example, checklist
- [ ] End-to-end example produces valid `plan.json` and `ticket.json` JSON blocks
- [ ] Matches the style and structure of `skills/providers/linear/SKILL.md`

#### Tasks

1. **Create directory scaffold**

   Create `skills/providers/filesystem/` with `.gitkeep`.

   #### Acceptance criteria
   - [ ] `skills/providers/filesystem/.gitkeep` exists

2. **Write SKILL.md sections 1–4**

   Overview, reading issues (list `.md` files, parse frontmatter + sections), field mapping table, acceptance criteria extraction.

   #### Acceptance criteria
   - [ ] Field mapping table covers all 8 orchestrator fields
   - [ ] AC extraction documents the `## Acceptance Criteria` section lookup and fallback

3. **Write SKILL.md sections 5–9**

   Dependency resolution (manual `## Dependencies` section or ask user), branch/worktree naming, workflow selection table, end-to-end example, checklist.

   #### Acceptance criteria
   - [ ] End-to-end example has valid `plan.json` and `ticket.json`
   - [ ] Checklist includes `orchestrator status` verification step
