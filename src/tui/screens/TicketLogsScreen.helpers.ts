import type { AgentSession } from "../../core/types.js";
import { wrapText } from "./TicketDetailsScreen.helpers.js";

export type LogEvent =
  | { type: "phase-divider"; phase: string; session: AgentSession }
  | { type: "assistant-text"; text: string }
  | { type: "tool-use"; name: string; input: unknown }
  | { type: "tool-result"; callId: string; name: string; isError: boolean };

export type LogLine =
  | { type: "divider"; phase: string; session: AgentSession }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "tool-result"; name: string; isError: boolean }
  | { type: "blank" };

export function parseNormalizedSessionJsonl(content: string): LogEvent[] {
  const events: LogEvent[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof obj !== "object" || obj === null) continue;
    const event = obj as Record<string, unknown>;

    if (event.type === "assistant-text" && typeof event.text === "string") {
      events.push({ type: "assistant-text", text: event.text });
    } else if (
      event.type === "tool-use" &&
      typeof event.toolName === "string"
    ) {
      events.push({
        type: "tool-use",
        name: event.toolName,
        input: event.input ?? null,
      });
    } else if (
      event.type === "tool-result" &&
      typeof event.callId === "string" &&
      typeof event.toolName === "string"
    ) {
      events.push({
        type: "tool-result",
        callId: event.callId,
        name: event.toolName,
        isError: event.isError === true,
      });
    }
    // session-start, warning: not rendered
  }

  return events;
}

export function inlineInput(input: unknown, maxLen: number): string {
  let result: string;

  if (typeof input === "object" && input !== null) {
    const inp = input as Record<string, unknown>;
    if (typeof inp.file_path === "string") {
      result = `file_path=${inp.file_path}`;
    } else if (typeof inp.command === "string") {
      result = `command=${inp.command}`;
    } else if (typeof inp.pattern === "string") {
      result = `pattern=${inp.pattern}`;
    } else {
      result = JSON.stringify(input);
    }
  } else {
    result = JSON.stringify(input);
  }

  if (result.length > maxLen) {
    return `${result.slice(0, Math.max(0, maxLen - 1))}…`;
  }
  return result;
}

export function buildLogLines(events: LogEvent[], width: number): LogLine[] {
  const lines: LogLine[] = [];

  for (const event of events) {
    if (event.type === "phase-divider") {
      lines.push({
        type: "divider",
        phase: event.phase,
        session: event.session,
      });
      lines.push({ type: "blank" });
    } else if (event.type === "assistant-text") {
      const textLines = event.text.split("\n");
      for (const textLine of textLines) {
        if (!textLine.trim()) {
          lines.push({ type: "blank" });
        } else {
          for (const wl of wrapText(textLine, width)) {
            lines.push({ type: "text", text: wl });
          }
        }
      }
      lines.push({ type: "blank" });
    } else if (event.type === "tool-use") {
      const maxSummaryLen = Math.max(0, width - event.name.length - 4);
      const summary = inlineInput(event.input, maxSummaryLen);
      lines.push({ type: "tool", name: event.name, summary });
      lines.push({ type: "blank" });
    } else if (event.type === "tool-result") {
      lines.push({
        type: "tool-result",
        name: event.name,
        isError: event.isError,
      });
      lines.push({ type: "blank" });
    }
  }

  return lines;
}
