# TUI Ticket Details Screen

**Date:** 2026-04-21
**Status:** Approved

## Overview

Add a read-only drill-in screen that shows the details of a single ticket — title, identity fields (status, phase, branch, worktree), description, and acceptance criteria. Users reach it by pressing `d` (or `⏎`) on the selected ticket in the tickets list and return with `esc`. Long content scrolls.

## Navigation

Extend the `Screen` union in `src/tui/hooks/useScreen.ts`:

```ts
type Screen =
  | { type: "plans" }
  | { type: "tickets"; planId: string }
  | { type: "ticket-details"; planId: string; ticketId: string };
```

New action `showTicketDetailsScreen({ planId, ticketId })` dispatches a transition to the new state. Existing `showPlansScreen` / `showTicketsScreen` are unchanged.

In `src/tui/app.tsx`:

- Resolve the selected ticket when `currentScreen.type === "ticket-details"` by looking it up in `ticketsByPlan.get(planId)`.
- The global `esc` handler unwinds one level: `ticket-details → tickets`, `tickets → plans`.
- Global `q` already quits from any screen — no change.
- Breadcrumb on the details screen: `Plans › <plan name> › <ticketId>`.

## Hotkey wiring

**TicketsScreen** accepts a new `onOpenTicket(ticketId: string)` prop (mirrors how `PlansScreen` already accepts `onSelectPlan`). Its `useInput` handler calls `onOpenTicket(ticket.ticketId)` on `d` or `⏎` for the selected row. Existing `p` / `r` / `s` handlers are unchanged.

`app.tsx` wires the prop: `(ticketId) => showTicketDetailsScreen({ planId: selectedPlan.id, ticketId })`.

Footer hotkeys:

- `PLANS_HOTKEYS` — unchanged.
- `TICKETS_HOTKEYS` — change `⏎ open` to `d/⏎ details` so the label reflects actual behavior.
- `TICKET_DETAILS_HOTKEYS` (new) — `↑↓ scroll`, `PgUp/PgDn page`, `g/G top/bottom`, `esc back`, `q quit`.

`app.tsx` selects the footer hotkey set via the existing ternary, extended to three cases.

## Layout

New component `src/tui/screens/TicketDetailsScreen.tsx`. Props: `{ ticket: TicketState; height: number; width: number }`. Single scrollable viewport; the breadcrumb above it (rendered by `app.tsx`) provides the ticket ID for orientation. The screen does not need `PlanFile` — all displayed fields live on `TicketState`.

Content, top to bottom:

```
Title:     <ticket.title>

Status:    <StatusBadge>     Phase:  <phase label>
Branch:    <ticket.branch>
Worktree:  <ticket.worktree>

Description
───────────
<ticket.description — word-wrapped to terminal width>

Acceptance criteria
───────────────────
1. <item>
2. <item>
...
```

Details:

- Field labels are a fixed-width column (10 characters) so values align vertically.
- Status re-uses `StatusBadge`; phase re-uses `PHASE_LABELS` / `PHASE_COLORS` from `src/tui/constants/phase.ts` (same formatting as the tickets list).
- Missing description renders `—` dimmed.
- Empty acceptance criteria list renders `—` dimmed.
- Section headings (`Description`, `Acceptance criteria`) are followed by a horizontal rule (box-drawing light line) matching the section heading's width.

No new styling primitives are introduced.

## Scrolling

Local state in `TicketDetailsScreen`: `scrollOffset: number` (lines hidden above the viewport). The component builds the full content as an array of already-wrapped lines, then slices `[scrollOffset, scrollOffset + viewportHeight]` for rendering.

Key handling in a component-local `useInput`:

- `↑` / `k` — `scrollOffset -= 1`
- `↓` / `j` — `scrollOffset += 1`
- `PgUp` — `scrollOffset -= max(1, viewportHeight - 1)`
- `PgDn` — `scrollOffset += max(1, viewportHeight - 1)`
- `g` — jump to top (`0`)
- `G` — jump to bottom (`maxOffset`)

Offset clamps to `[0, max(0, totalLines - viewportHeight)]`. When content fits, scroll keys are no-ops.

Viewport height comes from the `height` prop, computed by `app.tsx` the same way it already does for the list screens. Terminal width comes from `useStdout()` and is passed in as `width`, used to wrap the description.

Overflow indicator: when `totalLines > viewportHeight`, the final row of the viewport is reserved for a dim, right-aligned `↑↓ N/M` status (`N` = last visible line index, `M` = total lines). The effective content slice is `[scrollOffset, scrollOffset + viewportHeight - 1]` when overflow is present, `[scrollOffset, scrollOffset + viewportHeight]` when not. `maxOffset` is computed against the content slice size so that scrolling to the bottom shows the last content line.

## Line building

A pure helper co-located with the screen:

```ts
type DetailLine =
  | { type: "text"; text: string; dim?: boolean }
  | { type: "status-phase"; status: TicketStatus; phase: string }
  | { type: "heading"; text: string };

buildDetailLines(ticket: TicketState, width: number): DetailLine[]
```

Takes a ticket and the available width, returns the full flattened, word-wrapped line array for the viewport. One `DetailLine` equals one rendered terminal row. Keeping this as a pure function lets it be unit-tested without mounting Ink.

Word wrapping for the description uses a simple greedy word-break at whitespace, respecting the label column offset so the description column width is `width - labelColumnWidth`.

The screen maps each `DetailLine` to the appropriate Ink element (`text` → dim or plain `<Text>`, `status-phase` → `<StatusBadge>` + phase label, `heading` → bold text plus the horizontal-rule line below). The helper's unit tests verify line counts and discriminant order; rendering tests verify element output.

## Files Changed

| File | Change |
|------|--------|
| `src/tui/hooks/useScreen.ts` | Add `ticket-details` variant; add `showTicketDetailsScreen` action |
| `src/tui/app.tsx` | Route to new screen; extend `esc` handler; resolve selected ticket; add `TICKET_DETAILS_HOTKEYS`; update `TICKETS_HOTKEYS` label; pass `width` down |
| `src/tui/screens/TicketsScreen.tsx` | Accept `onOpenTicket` prop; handle `d` and `⏎` keys |
| `src/tui/screens/TicketDetailsScreen.tsx` (new) | Screen component + `buildDetailLines` helper + scroll clamp |
| `src/tui/screens/TicketDetailsScreen.test.tsx` (new) | Unit + render tests (see below) |
| `src/tui/hooks/useScreen.test.ts` (new) | Reducer transitions for new state |

## Testing

Match the existing pattern in `TicketsScreen.test.tsx` using `ink-testing-library`:

- **`useScreen` reducer** — transitions: plans → tickets → ticket-details → tickets → plans; direct ticket-details dispatch.
- **`buildDetailLines` helper** — line counts and ordering for: short description, long wrapped description that spans multiple lines, empty description, empty acceptance criteria, many acceptance criteria, narrow width.
- **`clampScrollOffset(offset, total, viewport)`** — pure function tests: overscroll up clamps to 0; overscroll down clamps to `max(0, total - viewport)`; content fits (total ≤ viewport) always yields 0.
- **`TicketDetailsScreen` render** — renders all labeled fields; `—` for empty description and empty AC; overflow indicator appears only when content overflows; scroll offset hides top lines.
- **Hotkey integration** — pressing `d` on TicketsScreen calls the `onOpenTicket` prop with the selected ticket's ID; pressing `⏎` behaves identically.

No new test infrastructure. No end-to-end tests — the TUI has none today.

## Out of Scope

- Editing any ticket fields.
- Copying branch / worktree / session from the details screen (still available on TicketsScreen as today).
- Displaying phase history, retries, or per-phase logs.
- Opening `linearUrl` in a browser; it is not displayed in v1.
- A plan details screen (same pattern would apply, different fields).
- Linux clipboard support — no clipboard actions are added here.
