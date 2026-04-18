import { Text } from "ink";
import type React from "react";

const STATUS_COLORS: Record<string, string> = {
  active: "cyan",
  running: "cyan",
  complete: "green",
  failed: "red",
  needs_attention: "red",
  paused: "yellow",
  queued: "gray",
  ready: "blue",
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const color = STATUS_COLORS[status] ?? "white";
  return <Text color={color}>{status}</Text>;
}
