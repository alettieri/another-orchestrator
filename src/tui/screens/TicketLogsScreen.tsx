import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TicketState } from "../../core/types.js";
import { useSessionLogs } from "../hooks/useSessionLogs.js";
import { clampScrollOffset } from "./TicketDetailsScreen.helpers.js";
import { buildLogLines, type LogLine } from "./TicketLogsScreen.helpers.js";

interface TicketLogsScreenProps {
  ticket: TicketState;
  height: number;
  width: number;
  stateDir: string;
}

export function TicketLogsScreen({
  ticket,
  height,
  width,
  stateDir,
}: TicketLogsScreenProps): React.ReactElement {
  const events = useSessionLogs(ticket, stateDir);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [pinned, setPinned] = useState(true);

  const allLines = useMemo(() => buildLogLines(events, width), [events, width]);
  const totalLines = allLines.length;
  const hasOverflow = totalLines > height;
  const effectiveViewport = hasOverflow ? height - 1 : height;
  const maxOffset = Math.max(0, totalLines - effectiveViewport);

  const prevTotalLinesRef = useRef(0);
  useEffect(() => {
    if (pinned && totalLines > prevTotalLinesRef.current) {
      setScrollOffset(maxOffset);
    }
    prevTotalLinesRef.current = totalLines;
  }, [pinned, totalLines, maxOffset]);

  useInput((_input, key) => {
    if (totalLines === 0) return;

    const isUpward =
      key.upArrow || _input === "k" || key.pageUp || _input === "g";

    let next = scrollOffset;
    if (key.upArrow || _input === "k") {
      next = clampScrollOffset(scrollOffset - 1, totalLines, effectiveViewport);
    }
    if (key.downArrow || _input === "j") {
      next = clampScrollOffset(scrollOffset + 1, totalLines, effectiveViewport);
    }
    if (key.pageUp) {
      next = clampScrollOffset(
        scrollOffset - Math.max(1, effectiveViewport - 1),
        totalLines,
        effectiveViewport,
      );
    }
    if (key.pageDown) {
      next = clampScrollOffset(
        scrollOffset + Math.max(1, effectiveViewport - 1),
        totalLines,
        effectiveViewport,
      );
    }
    if (_input === "g") {
      next = 0;
    }
    if (_input === "G") {
      next = maxOffset;
    }

    setScrollOffset(next);

    if (isUpward) {
      setPinned(false);
    } else if (next >= maxOffset) {
      setPinned(true);
    }
  });

  if (totalLines === 0) {
    return <Text dimColor>No session logs yet.</Text>;
  }

  const visibleLines = allLines.slice(
    scrollOffset,
    scrollOffset + effectiveViewport,
  );

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only; position is stable identity
        <LogLineRow key={i} line={line} />
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

function LogLineRow({ line }: { line: LogLine }): React.ReactElement {
  if (line.type === "divider") {
    return (
      <Text
        dimColor
      >{`─── ${line.phase}  ${line.session.provider}:${line.session.id.slice(0, 8)} ───`}</Text>
    );
  }
  if (line.type === "text") {
    return <Text>{line.text}</Text>;
  }
  if (line.type === "tool") {
    return (
      <Box>
        <Text color="cyan">{`▸ ${line.name}`}</Text>
        <Text dimColor>{` ${line.summary}`}</Text>
      </Box>
    );
  }
  if (line.type === "tool-result") {
    return (
      <Box>
        <Text color={line.isError ? "red" : "green"}>
          {line.isError ? "✗" : "✓"}
        </Text>
        <Text dimColor>{` ${line.name}`}</Text>
      </Box>
    );
  }
  return <Text> </Text>;
}
