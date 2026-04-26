import type React from "react";
import { buildAcceptanceCriteriaSectionLines } from "./TicketAcceptanceCriteriaSection.helpers.js";
import { TicketDetailRow } from "./TicketDetailRow.js";

interface TicketAcceptanceCriteriaSectionProps {
  acceptanceCriteria: readonly string[] | null | undefined;
  width: number;
  visibleStart: number;
  visibleLineCount: number;
}

export function TicketAcceptanceCriteriaSection({
  acceptanceCriteria,
  width,
  visibleStart,
  visibleLineCount,
}: TicketAcceptanceCriteriaSectionProps): React.ReactElement {
  const visibleLines = buildAcceptanceCriteriaSectionLines(
    acceptanceCriteria,
    width,
  ).slice(visibleStart, visibleStart + visibleLineCount);

  return (
    <>
      {visibleLines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: section lines are derived from stable criteria order
        <TicketDetailRow key={i} line={line} />
      ))}
    </>
  );
}
