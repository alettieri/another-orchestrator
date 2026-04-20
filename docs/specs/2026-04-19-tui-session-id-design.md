# TUI Session ID Display & Copy

**Date:** 2026-04-19
**Status:** Approved

## Overview

Expose the most recent Claude session ID for each ticket inline on the TUI tickets screen, and allow copying it to clipboard with a single keypress.

## Data

Add `getLatestSessionId(ticket: TicketState): string | null` in `TicketsScreen.tsx`. Walks `ticket.phaseHistory` in reverse and returns the first `sessionId` found, or `null` if none exists. Used by both the SESSION column renderer and the copy handler.

## Display

Add a `SESSION` column (width 14) as the last column in the tickets table. Renders the latest session ID truncated to 10 chars with a `…` suffix when longer (e.g., `abc123defg…`). Shows `—` dimmed when no session ID exists. Truncation is display-only; the full ID is used for copy.

## Copy

`useInput` inside `TicketsScreen` listens for `c`. On press:
1. Calls `getLatestSessionId` for the currently selected ticket.
2. If no session ID exists, the keypress is a no-op.
3. Pipes the full session ID to `pbcopy` via `execSync`.
4. Sets a `copied` state variable to `true`; a `setTimeout` of 1500ms resets it to `false`.
5. While `copied` is `true`, the SESSION cell for the selected row renders `"Copied!"` instead of the truncated ID.

`c` is added to `TICKETS_HOTKEYS` in `app.tsx` with label `"copy session"`.

## Files Changed

| File | Change |
|------|--------|
| `src/tui/screens/TicketsScreen.tsx` | Add `getLatestSessionId`, SESSION column, `useInput` copy handler, copied feedback state |
| `src/tui/app.tsx` | Add `c` hotkey to `TICKETS_HOTKEYS` |

## Out of Scope

- Linux clipboard support (`xclip`/`xsel`) — macOS only for now
- Copying session IDs from the plans screen
- Showing full session history in the TUI
