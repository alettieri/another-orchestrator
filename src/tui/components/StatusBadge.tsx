import { Text } from "ink";
import type React from "react";
import { STATUS_COLORS } from "../constants/status.js";
import type { TuiStatus } from "../types/status.js";

interface StatusBadgeProps {
  status: TuiStatus;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const color = STATUS_COLORS[status] ?? "white";
  return <Text color={color}>{status}</Text>;
}
