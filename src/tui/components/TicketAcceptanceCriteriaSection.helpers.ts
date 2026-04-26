import { wrapText } from "../utils/text.js";
import type { TicketDetailLine } from "./TicketDetailRow.helpers.js";
import { LABEL_WIDTH } from "./TicketDetailRow.helpers.js";

export function buildAcceptanceCriteriaSectionLines(
  acceptanceCriteria: readonly string[] | null | undefined,
  width: number,
): TicketDetailLine[] {
  const lines: TicketDetailLine[] = [
    { type: "heading", text: "Acceptance criteria" },
  ];
  const wrapWidth = Math.max(1, width - LABEL_WIDTH);

  if (!acceptanceCriteria || acceptanceCriteria.length === 0) {
    lines.push({ type: "text", text: "—", dim: true });
    return lines;
  }

  for (const [i, criterion] of acceptanceCriteria.entries()) {
    const prefix = `${i + 1}. `;
    const indentWidth = prefix.length;
    const wrapped = wrapText(criterion, Math.max(1, wrapWidth - indentWidth));

    for (const [j, line] of wrapped.entries()) {
      lines.push({
        type: "text",
        text:
          j === 0 ? `${prefix}${line}` : `${" ".repeat(indentWidth)}${line}`,
      });
    }
  }

  return lines;
}
