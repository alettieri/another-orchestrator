import { Box, Text } from "ink";
import type React from "react";

interface HeaderProps {
  planCount: number;
  runningCount: number;
}

export function Header({
  planCount,
  runningCount,
}: HeaderProps): React.ReactElement {
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text bold color="cyan">
        orchestrator
      </Text>
      <Text>
        <Text dimColor>
          {planCount} plans, {runningCount} running
        </Text>
        {"  "}
        <Text color="green" bold>
          ● live
        </Text>
      </Text>
    </Box>
  );
}
