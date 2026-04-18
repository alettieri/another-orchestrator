import { Box, Text } from "ink";
import type React from "react";

interface BreadcrumbProps {
  path: string[];
}

export function Breadcrumb({ path }: BreadcrumbProps): React.ReactElement {
  return (
    <Box>
      {path.map((segment, i) => (
        <Text key={segment}>
          {i > 0 && <Text dimColor> › </Text>}
          {i === path.length - 1 ? (
            <Text bold>{segment}</Text>
          ) : (
            <Text dimColor>{segment}</Text>
          )}
        </Text>
      ))}
    </Box>
  );
}
