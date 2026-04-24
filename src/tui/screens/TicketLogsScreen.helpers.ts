import os from "node:os";
import type { AgentSession } from "../../core/types.js";
import { wrapText } from "./TicketDetailsScreen.helpers.js";

export type ClaudeSession = AgentSession & { provider: "claude" };

export type LogEvent =
  | { type: "phase-divider"; phase: string; session: AgentSession }
  | { type: "assistant-text"; text: string }
  | { type: "tool-use"; name: string; input: unknown };

export type LogLine =
  | { type: "divider"; phase: string; session: AgentSession }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "blank" };

export function resolveClaudeSessionPath(
  worktree: string,
  session: ClaudeSession,
): string {
  const sanitized = worktree.replaceAll("/", "-");
  const home = os.homedir();
  return `${home}/.claude/projects/${sanitized}/${session.id}.jsonl`;
}

export function parseSessionJsonl(content: string): LogEvent[] {
  const events: LogEvent[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      typeof obj !== "object" ||
      obj === null ||
      (obj as Record<string, unknown>).type !== "assistant"
    ) {
      continue;
    }

    const message = (obj as Record<string, unknown>).message;
    if (typeof message !== "object" || message === null) continue;

    const contentArr = (message as Record<string, unknown>).content;
    if (!Array.isArray(contentArr)) continue;

    for (const block of contentArr) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;

      if (b.type === "text" && typeof b.text === "string") {
        events.push({ type: "assistant-text", text: b.text });
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        events.push({ type: "tool-use", name: b.name, input: b.input });
      }
    }
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
    }
  }

  return lines;
}
