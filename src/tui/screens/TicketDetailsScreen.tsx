import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { TicketState, TicketStatus } from "../../core/types.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { PHASE_COLORS, PHASE_LABELS } from "../constants/phase.js";
import type { PhaseId } from "../types/phase.js";

const LABEL_WIDTH = 10;

type DetailLine =
  | { type: "text"; text: string; dim?: boolean }
  | { type: "status-phase"; status: TicketStatus; phase: string }
  | { type: "heading"; text: string };

export function buildDetailLines(
  ticket: TicketState,
  width: number,
): DetailLine[] {
  const lines: DetailLine[] = [];
  const descWidth = Math.max(1, width - LABEL_WIDTH);

  // 1. Title
  lines.push({
    type: "text",
    text: `${"Title:".padEnd(LABEL_WIDTH)}${ticket.title}`,
  });

  // 2. Blank
  lines.push({ type: "text", text: "" });

  // 3. Status + phase
  lines.push({
    type: "status-phase",
    status: ticket.status,
    phase: ticket.currentPhase,
  });

  // 4. Branch
  lines.push({
    type: "text",
    text: `${"Branch:".padEnd(LABEL_WIDTH)}${ticket.branch}`,
  });

  // 5. Worktree
  lines.push({
    type: "text",
    text: `${"Worktree:".padEnd(LABEL_WIDTH)}${ticket.worktree}`,
  });

  // 6. Blank
  lines.push({ type: "text", text: "" });

  // 7. Description heading + rule
  lines.push({ type: "heading", text: "Description" });

  // 8. Description lines
  if (!ticket.description || ticket.description.trim() === "") {
    lines.push({ type: "text", text: "—", dim: true });
  } else {
    const wrapped = wrapText(ticket.description, descWidth);
    for (const line of wrapped) {
      lines.push({ type: "text", text: line });
    }
  }

  // 9. Blank
  lines.push({ type: "text", text: "" });

  // 10. Acceptance criteria heading + rule
  lines.push({ type: "heading", text: "Acceptance criteria" });

  // 11. AC items
  if (!ticket.acceptanceCriteria || ticket.acceptanceCriteria.length === 0) {
    lines.push({ type: "text", text: "—", dim: true });
  } else {
    for (const [i, criterion] of ticket.acceptanceCriteria.entries()) {
      const prefix = `${i + 1}. `;
      const indentWidth = prefix.length;
      const wrapped = wrapText(criterion, Math.max(1, descWidth - indentWidth));
      for (const [j, wline] of wrapped.entries()) {
        lines.push({
          type: "text",
          text:
            j === 0
              ? `${prefix}${wline}`
              : `${" ".repeat(indentWidth)}${wline}`,
        });
      }
    }
  }

  return lines;
}

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!word) continue;
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function clampScrollOffset(
  offset: number,
  total: number,
  viewport: number,
): number {
  const max = Math.max(0, total - viewport);
  return Math.min(Math.max(0, offset), max);
}

interface TicketDetailsScreenProps {
  ticket: TicketState;
  height: number;
  width: number;
}

export function TicketDetailsScreen({
  ticket,
  height,
  width,
}: TicketDetailsScreenProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);

  const allLines = buildDetailLines(ticket, width);
  const totalLines = allLines.length;
  const hasOverflow = totalLines > height;
  const effectiveViewport = hasOverflow ? height - 1 : height;
  const maxOffset = Math.max(0, totalLines - effectiveViewport);

  useInput((_input, key) => {
    setScrollOffset((prev) => {
      if (key.upArrow || _input === "k") {
        return clampScrollOffset(prev - 1, totalLines, effectiveViewport);
      }
      if (key.downArrow || _input === "j") {
        return clampScrollOffset(prev + 1, totalLines, effectiveViewport);
      }
      if (key.pageUp) {
        return clampScrollOffset(
          prev - Math.max(1, effectiveViewport - 1),
          totalLines,
          effectiveViewport,
        );
      }
      if (key.pageDown) {
        return clampScrollOffset(
          prev + Math.max(1, effectiveViewport - 1),
          totalLines,
          effectiveViewport,
        );
      }
      if (_input === "g") {
        return 0;
      }
      if (_input === "G") {
        return maxOffset;
      }
      return prev;
    });
  });

  const visibleLines = allLines.slice(
    scrollOffset,
    scrollOffset + effectiveViewport,
  );

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, i) => renderDetailLine(line, i))}
      {hasOverflow && (
        <Text dimColor>
          {`↑↓ ${scrollOffset + effectiveViewport}/${totalLines}`.padStart(
            width,
          )}
        </Text>
      )}
    </Box>
  );
}

function renderDetailLine(line: DetailLine, key: number): React.ReactElement {
  if (line.type === "heading") {
    const rule = "─".repeat(line.text.length);
    return (
      <Box key={key} flexDirection="column">
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
      <Box key={key} flexDirection="row">
        <Text>{"Status:".padEnd(LABEL_WIDTH)}</Text>
        <StatusBadge status={line.status} />
        <Text>{"  Phase:   "}</Text>
        <Text color={color}>{label}</Text>
      </Box>
    );
  }

  return (
    <Text key={key} dimColor={line.dim}>
      {line.text}
    </Text>
  );
}
