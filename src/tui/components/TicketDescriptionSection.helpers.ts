import { wrapText } from "../utils/text.js";
import type { TicketDetailLine } from "./TicketDetailRow.helpers.js";
import { LABEL_WIDTH } from "./TicketDetailRow.helpers.js";

export function buildDescriptionSectionLines(
  description: string | null | undefined,
  width: number,
): TicketDetailLine[] {
  const lines: TicketDetailLine[] = [{ type: "heading", text: "Description" }];
  const wrapWidth = Math.max(1, width - LABEL_WIDTH);

  if (!description || description.trim() === "") {
    lines.push({ type: "text", text: "—", dim: true });
    return lines;
  }

  for (const line of wrapText(description, wrapWidth)) {
    lines.push({ type: "text", text: line });
  }

  return lines;
}
