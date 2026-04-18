import type { PlanStatus, TicketStatus } from "../../core/types.js";

/**
 * All status values that can appear in the TUI, combining plan and ticket statuses.
 */
export type TuiStatus = PlanStatus | TicketStatus;
