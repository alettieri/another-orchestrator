import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { TicketState } from "../../core/types.js";
import { TicketDetailRow } from "../components/TicketDetailRow.js";
import {
  buildDetailLines,
  clampScrollOffset,
} from "./TicketDetailsScreen.helpers.js";

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
      {visibleLines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines have no stable identity; order is fixed
        <TicketDetailRow key={i} line={line} />
      ))}
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
