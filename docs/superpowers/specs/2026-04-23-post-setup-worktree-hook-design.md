# Post-Setup Worktree Hook Design

Date: 2026-04-23

## Goal

Allow users to define a single global list of shell commands in `config.yaml` that run automatically after a git worktree is created. This is intended for per-project setup tasks such as installing dependencies and building the project before agent execution begins.

Example use case:

```yaml
postSetupWorktreeHooks:
  - npm install
  - npm run build
```

## Scope

This design adds one new global configuration field:

- `postSetupWorktreeHooks?: string[]`

The field is optional. When omitted or empty, worktree setup behaves exactly as it does today.

This design does not introduce:

- per-workflow hooks
- per-repo hooks
- pre-setup or cleanup hooks
- configurable failure policy
- a general lifecycle hook framework

## User Experience

Users add a small ordered list of commands to their global orchestrator config. When the orchestrator creates a worktree for a ticket, it runs those commands inside the new worktree directory after `git worktree add` succeeds.

Commands run in the order provided. They are executed with the worktree as the current working directory, so they can assume normal project-local behavior.

If a hook command fails, the failure is logged, but setup still succeeds. Only failure to create the worktree itself should fail the setup phase.

## Architecture

### Config surface

Extend the raw and resolved orchestrator config schemas in `src/core/types.ts` to include:

```ts
postSetupWorktreeHooks: z.array(z.string()).default([])
```

Using a default empty array keeps downstream logic simple and avoids optional branching in most call sites.

### Config loading

`src/core/config.ts` already parses YAML into `RawOrchestratorConfigSchema` and then validates the resolved config. The new field should flow through unchanged, since it is not path-based and does not require additional resolution logic.

### Execution path

The existing setup phase is a `script` phase that invokes `setup-worktree.sh`. The phase executor should pass the configured hook list to the setup script only for that setup invocation path.

Recommended approach:

- serialize the configured hook array as JSON
- pass it as an additional argument to `setup-worktree.sh`
- treat an empty array as "no hooks configured"

This keeps the hook source explicit and avoids coupling shell behavior to external config file parsing.

### Script behavior

Update `scripts/setup-worktree.sh` to accept one additional argument containing the serialized hook list.

Script flow:

1. Validate arguments.
2. Create the worktree using the current branch creation logic.
3. If no hooks are configured, exit successfully.
4. Change into the new worktree directory.
5. Execute each configured command in order.
6. If a command exits non-zero, print a clear warning and continue.
7. Exit successfully once all hooks have been attempted.

The script remains responsible only for worktree creation plus immediate post-setup bootstrapping.

## Data Flow

1. User sets `postSetupWorktreeHooks` in global `config.yaml`.
2. `loadConfig()` parses and validates the list.
3. `createPhaseExecutor()` reads the resolved config.
4. The setup script phase receives the hook payload.
5. `setup-worktree.sh` creates the worktree.
6. `setup-worktree.sh` runs the configured commands in the new worktree.
7. Control returns to the workflow, which proceeds to the next phase even if one or more hook commands failed.

## Failure Handling

Failure semantics are intentionally narrow:

- If `git fetch` or `git worktree add` fails, the setup phase fails.
- If a post-setup hook command fails, the failure is logged and ignored.
- Hook failures do not alter ticket state, retry behavior, or workflow routing.

This keeps the feature low-friction for expensive setup tasks that may be useful but non-critical.

## Logging

Hook execution should be visible in the normal script logs. For each command, log:

- that the hook is starting
- the command string being run
- whether it succeeded or failed

When a command fails, include the exit code in the warning output when practical.

## Testing

### Type and config tests

Update tests around `src/core/types.ts` and config loading to cover:

- config with no `postSetupWorktreeHooks`
- config with `postSetupWorktreeHooks: []`
- config with multiple hook commands

### Phase executor tests

Update `src/phases/executor.test.ts` to verify that setup script invocation includes the hook payload when hooks are configured and still works when the list is empty.

### Script behavior tests

If there is an existing pattern for testing scripts directly, add coverage for:

- hooks running in order
- hooks running from the worktree directory
- hook failure not failing the script

If there is no current shell-script test pattern, keep the shell logic minimal and rely on TypeScript-level coverage plus manual verification during implementation.

## Documentation Changes

Update:

- `skills/config/SKILL.md` to document the new config field and example usage
- any config schema examples that show the full YAML structure
- `docs/workflows.md` only if a brief note is needed to explain that the setup script may run global post-setup hooks from config

## Files Expected To Change During Implementation

- `src/core/types.ts`
- `src/core/types.test.ts`
- `src/core/config.ts`
- `src/phases/executor.ts`
- `src/phases/executor.test.ts`
- `scripts/setup-worktree.sh`
- `skills/config/SKILL.md`
- possibly `docs/workflows.md`

## Open Decisions Resolved

- Hook scope: one global config entry
- Hook shape: ordered list of shell command strings
- Execution point: immediately after worktree creation
- Working directory: the new worktree
- Failure policy: best-effort, non-blocking

## Out Of Scope Follow-Ups

Potential future extensions, intentionally excluded from this design:

- repo-specific hook configuration
- lifecycle hooks beyond post-setup
- structured command objects instead of shell strings
- configurable strict/required hook behavior
- surfacing hook results separately in ticket context
