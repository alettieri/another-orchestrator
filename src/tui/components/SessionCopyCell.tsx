import { execSync } from "node:child_process";
import { Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { AgentSession } from "../../core/types.js";

interface SessionCopyCellProps {
  session: AgentSession | null;
  isSelected: boolean;
}

export function SessionCopyCell({
  session,
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
    if (!isSelected || input !== "c" || session?.provider !== "claude") return;
    execSync("pbcopy", { input: `claude --resume ${session.id}` });
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setCopied(true);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  });

  if (copied) return <Text color="green">Copied!</Text>;
  if (!session) return <Text dimColor>—</Text>;
  const display =
    session.id.length > 10 ? `${session.id.slice(0, 10)}…` : session.id;
  return <Text>{display}</Text>;
}
