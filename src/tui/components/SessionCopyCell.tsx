import { execSync } from "node:child_process";
import { Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";

interface SessionCopyCellProps {
  sessionId: string | null;
  isSelected: boolean;
}

export function SessionCopyCell({
  sessionId,
  isSelected,
}: SessionCopyCellProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  useInput((input) => {
    if (!isSelected || input !== "c" || !sessionId) return;
    execSync(`echo -n ${JSON.stringify(sessionId)} | pbcopy`);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setCopied(true);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  });

  if (copied) return <Text color="green">Copied!</Text>;
  if (!sessionId) return <Text dimColor>—</Text>;
  const display =
    sessionId.length > 10 ? `${sessionId.slice(0, 10)}…` : sessionId;
  return <Text>{display}</Text>;
}
