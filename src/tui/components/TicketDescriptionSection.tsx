import type React from "react";
import { buildDescriptionSectionLines } from "./TicketDescriptionSection.helpers.js";
import { TicketDetailRow } from "./TicketDetailRow.js";

interface TicketDescriptionSectionProps {
  description: string | null | undefined;
  width: number;
  visibleStart: number;
  visibleLineCount: number;
}

export function TicketDescriptionSection({
  description,
  width,
  visibleStart,
  visibleLineCount,
}: TicketDescriptionSectionProps): React.ReactElement {
  const visibleLines = buildDescriptionSectionLines(description, width).slice(
    visibleStart,
    visibleStart + visibleLineCount,
  );

  return (
    <>
      {visibleLines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: section lines are derived from stable text order
        <TicketDetailRow key={i} line={line} />
      ))}
    </>
  );
}
