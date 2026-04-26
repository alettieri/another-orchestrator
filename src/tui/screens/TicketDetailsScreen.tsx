import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { TicketState } from "../../core/types.js";
import { TicketAcceptanceCriteriaSection } from "../components/TicketAcceptanceCriteriaSection.js";
import { TicketDescriptionSection } from "../components/TicketDescriptionSection.js";
import { TicketDetailRow } from "../components/TicketDetailRow.js";
import {
  buildDetailBlocks,
  clampScrollOffset,
  getVisibleDetailBlocks,
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

  const blocks = buildDetailBlocks(ticket, width);
  const totalLines = blocks.reduce(
    (total, block) => total + block.lineCount,
    0,
  );
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

  const visibleBlocks = getVisibleDetailBlocks(
    blocks,
    scrollOffset,
    effectiveViewport,
  );

  return (
    <Box flexDirection="column">
      {visibleBlocks.map(({ block, visibleStart, visibleLineCount }) => {
        if (block.type === "description") {
          return (
            <TicketDescriptionSection
              key={block.key}
              description={block.description}
              width={block.width}
              visibleStart={visibleStart}
              visibleLineCount={visibleLineCount}
            />
          );
        }

        if (block.type === "acceptance-criteria") {
          return (
            <TicketAcceptanceCriteriaSection
              key={block.key}
              acceptanceCriteria={block.acceptanceCriteria}
              width={block.width}
              visibleStart={visibleStart}
              visibleLineCount={visibleLineCount}
            />
          );
        }

        return block.lines
          .slice(visibleStart, visibleStart + visibleLineCount)
          .map((line, i) => (
            <TicketDetailRow key={`${block.key}-${i}`} line={line} />
          ));
      })}
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
