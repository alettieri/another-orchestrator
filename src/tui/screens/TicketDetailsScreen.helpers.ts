import type { TicketState } from "../../core/types.js";
import { buildAcceptanceCriteriaSectionLines } from "../components/TicketAcceptanceCriteriaSection.helpers.js";
import { buildDescriptionSectionLines } from "../components/TicketDescriptionSection.helpers.js";
import {
  LABEL_WIDTH,
  type TicketDetailLine,
} from "../components/TicketDetailRow.helpers.js";

export { wrapText } from "../utils/text.js";

export type TicketDetailsBlock =
  | { type: "lines"; key: string; lines: TicketDetailLine[]; lineCount: number }
  | {
      type: "description";
      key: string;
      description: string | null | undefined;
      width: number;
      lineCount: number;
    }
  | {
      type: "acceptance-criteria";
      key: string;
      acceptanceCriteria: readonly string[] | null | undefined;
      width: number;
      lineCount: number;
    };

export interface VisibleTicketDetailsBlock {
  block: TicketDetailsBlock;
  visibleStart: number;
  visibleLineCount: number;
}

export function buildDetailBlocks(
  ticket: TicketState,
  width: number,
): TicketDetailsBlock[] {
  const summaryLines = buildSummaryLines(ticket);

  return [
    {
      type: "lines",
      key: "summary",
      lines: summaryLines,
      lineCount: summaryLines.length,
    },
    {
      type: "description",
      key: "description",
      description: ticket.description,
      width,
      lineCount: buildDescriptionSectionLines(ticket.description, width).length,
    },
    {
      type: "lines",
      key: "description-spacer",
      lines: [{ type: "text", text: "" }],
      lineCount: 1,
    },
    {
      type: "acceptance-criteria",
      key: "acceptance-criteria",
      acceptanceCriteria: ticket.acceptanceCriteria,
      width,
      lineCount: buildAcceptanceCriteriaSectionLines(
        ticket.acceptanceCriteria,
        width,
      ).length,
    },
  ];
}

export function getVisibleDetailBlocks(
  blocks: readonly TicketDetailsBlock[],
  scrollOffset: number,
  viewport: number,
): VisibleTicketDetailsBlock[] {
  const visible: VisibleTicketDetailsBlock[] = [];
  let consumed = 0;
  const visibleEnd = scrollOffset + viewport;

  for (const block of blocks) {
    const blockStart = consumed;
    const blockEnd = blockStart + block.lineCount;
    consumed = blockEnd;

    if (blockEnd <= scrollOffset) continue;
    if (blockStart >= visibleEnd) break;

    const visibleStart = Math.max(0, scrollOffset - blockStart);
    const visibleLineCount =
      Math.min(blockEnd, visibleEnd) - Math.max(blockStart, scrollOffset);

    visible.push({ block, visibleStart, visibleLineCount });
  }

  return visible;
}

export function buildDetailLines(
  ticket: TicketState,
  width: number,
): TicketDetailLine[] {
  const lines = buildSummaryLines(ticket);

  lines.push(...buildDescriptionSectionLines(ticket.description, width));
  lines.push({ type: "text", text: "" });
  lines.push(
    ...buildAcceptanceCriteriaSectionLines(ticket.acceptanceCriteria, width),
  );

  return lines;
}

function buildSummaryLines(ticket: TicketState): TicketDetailLine[] {
  const lines: TicketDetailLine[] = [];

  lines.push({
    type: "text",
    text: `${"Title:".padEnd(LABEL_WIDTH)}${ticket.title}`,
  });

  lines.push({ type: "text", text: "" });

  lines.push({
    type: "status-phase",
    status: ticket.status,
    phase: ticket.currentPhase,
  });

  lines.push({
    type: "text",
    text: `${"Branch:".padEnd(LABEL_WIDTH)}${ticket.branch}`,
  });

  lines.push({
    type: "text",
    text: `${"Worktree:".padEnd(LABEL_WIDTH)}${ticket.worktree}`,
  });

  lines.push({ type: "text", text: "" });

  return lines;
}

export function clampScrollOffset(
  offset: number,
  total: number,
  viewport: number,
): number {
  const max = Math.max(0, total - viewport);
  return Math.min(Math.max(0, offset), max);
}
