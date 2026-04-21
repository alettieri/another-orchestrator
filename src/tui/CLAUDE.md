# TUI Component Conventions

Biome enforces most of the React hygiene in this subtree via `noNestedComponentDefinitions` (correctness) and `useComponentExportOnlyModules` (style). The rules below capture the conventions Biome can't enforce — or where we've chosen a specific resolution.

## One component per module

Every `.tsx` file under `src/tui/` exports exactly one React component. The component's name matches the filename (e.g., `Header.tsx` → `Header`).

Helpers, constants, and types used only by that component belong in a neighbor `*.helpers.ts` file (or `utils/`), not co-exported from the `.tsx`. The `useComponentExportOnlyModules` rule enforces this — a module that exports a component may only export components. See `TicketDetailRow.helpers.ts` and `TicketDetailsScreen.helpers.ts` for examples.

## Provider-wrap exception

A public component that exists only to wrap another in a context provider may declare both in the same file. The inner component uses an `*Inner` suffix and is **not** exported; the outer `App` wraps it with providers. `app.tsx` is the canonical example: it exports `App` and defines `AppInner` as a top-level sibling (not nested — `noNestedComponentDefinitions` would flag a truly nested component).

## Stateless vs. stateful

- `components/` — stateless / presentational. No `useState`, no `useInput`, no data fetching. Receives everything via props.
- `screens/` — stateful. Manages selection, hotkeys, and data access; composes components from `components/`. Receives plan/ticket data and callbacks via props.

## Hotkey ownership

- **Global** (`q`, `Esc`) — `app.tsx`.
- **Screen-level** (e.g., `d` / `Enter` to open, `p` / `r` / `s`) — inside the screen component.
- **Component-level** (e.g., `SessionCopyCell`'s `c`) — inside the component itself. Only use this for hotkeys that are meaningful to a single cell/row; anything broader belongs on the screen.

## Broader architecture

See `architecture.md` for navigation reducer, TanStack Query data flow, height management, and the no-React-context rule.
