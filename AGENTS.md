# Shell Environment

At the start of any coding session, load the correct Node version via nvm before running any commands:
```sh
source ~/.nvm/nvm.sh && nvm use
```
This ensures the project's `.nvmrc` is respected. Run this once at session start.

# Another Orchestrator

A CLI-driven orchestrator for managing agent workflows, plans, and tickets.

## Stack

- **Runtime**: Node 24 (see `.nvmrc`)
- **Package manager**: pnpm
- **Language**: TypeScript (strict mode, ES2022, Node16 module resolution)
- **Validation**: Zod schemas in `src/core/types.ts`
- **Linter/Formatter**: Biome (`biome.json`)
- **Test framework**: Vitest (no globals — use explicit imports from `vitest`)
- **CI**: GitHub Actions (`.github/workflows/ci.yml`)

## Commands

```sh
pnpm run lint        # biome check .
pnpm run lint:fix    # biome check --write .
pnpm run format      # biome format --write .
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest run
pnpm run test:watch  # vitest (watch mode)
pnpm run build       # tsc → dist/
```

## Project Structure

```
src/
  core/           # Shared types, schemas, utilities
  cli.ts          # CLI entry point
```

## Conventions

### Code Style

- Biome handles formatting and linting — do not use Prettier or ESLint.
- 2-space indentation, double quotes.
- Run `pnpm run lint:fix` to auto-fix before committing.

### Testing

- Test files live next to their source: `foo.ts` → `foo.test.ts`.
- Import `describe`, `it`, `expect` explicitly from `vitest` (no globals).
- Test Zod schemas by checking: valid parsing, default values, and rejection of invalid data.
- Keep tests focused — one behavior per `it()` block.

### Types

- All data shapes are defined as Zod schemas in `src/core/types.ts`.
- Export both the schema (`FooSchema`) and inferred type (`Foo`).
- Prefer Zod defaults over optional fields where a sensible default exists.

### Workflow

1. Write or modify code.
2. Run `pnpm run lint:fix` to format.
3. Run `pnpm run typecheck` to catch type errors.
4. Run `pnpm run test` to verify behavior.
5. All three must pass before considering work complete.
