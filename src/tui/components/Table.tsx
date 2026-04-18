import { Box, Text, useInput } from "ink";
import { type ReactElement, useCallback } from "react";

export interface Column {
  key: string;
  label: string;
  width?: number;
  align?: "left" | "right";
}

export interface TableProps {
  columns: Column[];
  rows: Record<string, ReactElement | string>[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onActivate?: (index: number) => void;
  height?: number;
}

export function Table({
  columns,
  rows,
  selectedIndex,
  onSelect,
  onActivate,
  height,
}: TableProps): ReactElement {
  const maxVisible = height ?? rows.length;

  useInput(
    useCallback(
      (_input, key) => {
        if (key.upArrow) {
          onSelect(Math.max(0, selectedIndex - 1));
        } else if (key.downArrow) {
          onSelect(Math.min(rows.length - 1, selectedIndex + 1));
        } else if (key.return && onActivate) {
          onActivate(selectedIndex);
        }
      },
      [selectedIndex, rows.length, onSelect, onActivate],
    ),
  );

  // Compute scroll window
  let startIndex = 0;
  if (rows.length > maxVisible) {
    startIndex = Math.min(
      Math.max(0, selectedIndex - Math.floor(maxVisible / 2)),
      rows.length - maxVisible,
    );
  }
  const visibleRows = rows.slice(startIndex, startIndex + maxVisible);

  return (
    <Box flexDirection="column">
      {/* Header row */}
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{"  "}</Text>
        {columns.map((col) => (
          <Box key={col.key} width={col.width ?? 16}>
            <Text bold dimColor>
              {col.label}
            </Text>
          </Box>
        ))}
      </Box>
      {/* Data rows */}
      {visibleRows.map((row, vi) => {
        const realIndex = startIndex + vi;
        const isSelected = realIndex === selectedIndex;
        return (
          <Box key={realIndex} flexDirection="row" gap={1}>
            <Text color="cyan">{isSelected ? "›" : " "}</Text>
            {columns.map((col) => (
              <Box key={col.key} width={col.width ?? 16}>
                {typeof row[col.key] === "string" ? (
                  <Text inverse={isSelected}>{row[col.key] as string}</Text>
                ) : (
                  <Box>
                    {isSelected ? (
                      <Text inverse>{row[col.key]}</Text>
                    ) : (
                      row[col.key]
                    )}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
