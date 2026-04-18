import type { TuiStatus } from "../types/status.js";

export const STATUS_COLORS: Record<TuiStatus, string> = {
  active: "cyan",
  running: "cyan",
  complete: "green",
  failed: "red",
  needs_attention: "red",
  paused: "yellow",
  queued: "gray",
  ready: "blue",
};
