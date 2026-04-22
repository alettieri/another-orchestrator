import { Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  copyResumeCommandToClipboard,
  type SessionReference,
} from "../session.js";

interface SessionCopyCellProps {
  session: SessionReference | null;
  isSelected: boolean;
}

export function SessionCopyCell({
  session,
  isSelected,
}: SessionCopyCellProps): React.ReactElement {
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "unavailable"
  >("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  useInput((input) => {
    if (!isSelected || input !== "c" || !session) return;
    const copied = copyResumeCommandToClipboard(session);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setCopyStatus(copied ? "copied" : "unavailable");
    timeoutRef.current = setTimeout(() => setCopyStatus("idle"), 1500);
  });

  if (copyStatus === "copied") return <Text color="green">Copied!</Text>;
  if (copyStatus === "unavailable") {
    return <Text color="red">No clipboard</Text>;
  }
  if (!session) return <Text dimColor>—</Text>;
  const display =
    session.sessionId.length > 10
      ? `${session.sessionId.slice(0, 10)}…`
      : session.sessionId;
  return <Text>{display}</Text>;
}
