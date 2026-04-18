import { Box, Text } from "ink";
import type React from "react";

export interface Hotkey {
  key: string;
  label: string;
}

interface FooterProps {
  hotkeys: Hotkey[];
}

export function Footer({ hotkeys }: FooterProps): React.ReactElement {
  return (
    <Box flexDirection="row" gap={2}>
      {hotkeys.map((hk) => (
        <Text key={hk.key}>
          <Text bold color="cyan">
            {hk.key}
          </Text>{" "}
          <Text dimColor>{hk.label}</Text>
        </Text>
      ))}
    </Box>
  );
}
