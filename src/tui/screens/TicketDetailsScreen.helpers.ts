import type { TicketState } from "../../core/types.js";
import {
  LABEL_WIDTH,
  type TicketDetailLine,
} from "../components/TicketDetailRow.helpers.js";

export function buildDetailLines(
  ticket: TicketState,
  width: number,
): TicketDetailLine[] {
  const lines: TicketDetailLine[] = [];
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
