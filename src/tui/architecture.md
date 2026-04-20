# TUI Architecture

The TUI is built with **Ink** (React for terminals) + **React 19**. Before making any changes to TUI code, invoke the `vercel-react-best-practices` skill.

## Directory layout

```
src/tui/
  app.tsx               # Root component — threads stateManager, workflowLoader, screen state
  components/           # Stateless display components (Header, Footer, Breadcrumb, StatusBadge, Table, SessionCopyCell)
  screens/              # Full-screen views (PlansScreen, TicketsScreen)
  hooks/
    useScreen.ts        # Navigation state machine (plans ↔ tickets)
    useStateData.ts     # TanStack Query hooks + Chokidar file watcher
    useWorkflows.ts     # Workflow loading
  queries/
    query-client.ts     # TanStack React Query client config
  types/status.ts       # TypeScript definitions
  constants/status.ts   # STATUS_COLORS and phase color maps
```

## Key architectural decisions

**Navigation** — reducer-based, no routing library. Two screens: `plans` (root) and `tickets` (requires `planId`). Dispatch via `showPlansScreen()` / `showTicketsScreen({ planId })` from `useScreen`.

**Data fetching** — TanStack React Query v5. `usePlans()` and `useTicketsByPlan()` fetch state files; `useStateWatcher()` uses Chokidar (depth 2, 150ms debounce) to invalidate queries when files change on disk. No window-focus refetching.

**Component split** — stateless UI components in `components/`, stateful smart components in `screens/`. Screens accept data and handlers as props, manage local selection state, and memoize row data. The `Table` component owns keyboard navigation (↑↓), scrolling, and row highlighting.

**Interaction model** — global hotkeys (`q`, `Esc`) handled in `app.tsx` via Ink's `useInput`; screen-specific hotkeys handled inside each screen. `SessionCopyCell` is an example of component-level key capture (`c` to copy via `pbcopy`).

**State propagation** — no React context. `app.tsx` passes `stateManager` and `workflowLoader` down as props. Keep it that way unless the prop chain grows beyond two levels.

**Height management** — `app.tsx` computes available table height by subtracting fixed chrome (header, breadcrumb, column header, footer) from terminal height. Pass this down to `Table`.
