import { Box, Text } from "ink";
import type React from "react";
import { PHASE_COLORS, PHASE_LABELS } from "../constants/phase.js";
import type { PhaseId } from "../types/phase.js";
import { StatusBadge } from "./StatusBadge.js";
import {
  LABEL_WIDTH,
  type TicketDetailLine,
} from "./TicketDetailRow.helpers.js";

interface TicketDetailRowProps {
  line: TicketDetailLine;
}

export function TicketDetailRow({
  line,
}: TicketDetailRowProps): React.ReactElement {
  if (line.type === "heading") {
    const rule = "─".repeat(line.text.length);
    return (
      <Box flexDirection="column">
        <Text bold>{line.text}</Text>
        <Text dimColor>{rule}</Text>
      </Box>
    );
  }

  if (line.type === "status-phase") {
    const phaseId = line.phase as PhaseId;
    const label = PHASE_LABELS[phaseId] ?? line.phase;
    const color = PHASE_COLORS[phaseId];
    return (
      <Box flexDirection="row">
        <Text>{"Status:".padEnd(LABEL_WIDTH)}</Text>
        <StatusBadge status={line.status} />
        <Text>{"  Phase:   "}</Text>
        <Text color={color}>{label}</Text>
      </Box>
    );
  }

  return <Text dimColor={line.dim}>{line.text}</Text>;
}
