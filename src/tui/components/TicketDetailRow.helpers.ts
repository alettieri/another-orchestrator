import type { TicketStatus } from "../../core/types.js";

export const LABEL_WIDTH = 10;

export type TicketDetailLine =
  | { type: "text"; text: string; dim?: boolean }
  | { type: "status-phase"; status: TicketStatus; phase: string }
  | { type: "heading"; text: string };
