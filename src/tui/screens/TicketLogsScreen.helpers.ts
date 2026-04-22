import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import { wrapText } from "./TicketDetailsScreen.helpers.js";

export type LogEvent =
  | { type: "phase-divider"; phase: string; sessionId: string }
  | { type: "assistant-text"; text: string }
  | { type: "tool-use"; name: string; input: unknown };

export type LogLine =
  | { type: "divider"; phase: string; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "blank" };

export interface SessionLogReference {
  provider: string;
  sessionId: string;
}

export function resolveCodexSessionsRoot(): string {
  return `${os.homedir()}/.codex/sessions`;
}

export function resolveClaudeSessionPath(
  worktree: string,
  sessionId: string,
): string {
  const sanitized = worktree.replaceAll("/", "-");
  const home = os.homedir();
  return `${home}/.claude/projects/${sanitized}/${sessionId}.jsonl`;
}

async function findCodexSessionFileInDir(
  dir: string,
  sessionId: string,
): Promise<string | null> {
  let entries: Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
  } catch {
    return null;
  }

  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      const nested = await findCodexSessionFileInDir(path, sessionId);
      if (nested) return nested;
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(`${sessionId}.jsonl`) &&
      entry.name.startsWith("rollout-")
    ) {
      return path;
    }
  }

  return null;
}

export async function resolveSessionPath(
  worktree: string,
  session: SessionLogReference,
): Promise<string | null> {
  if (session.provider === "codex") {
    return findCodexSessionFileInDir(
      resolveCodexSessionsRoot(),
      session.sessionId,
    );
  }

  return resolveClaudeSessionPath(worktree, session.sessionId);
}

function parseClaudeSessionJsonl(content: string): LogEvent[] {
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

function collectCodexText(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const record = block as Record<string, unknown>;
    if (record.type === "output_text" && typeof record.text === "string") {
      return [record.text];
    }
    return [];
  });
}

function parseCodexFunctionInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseCodexSessionJsonl(content: string): LogEvent[] {
  const events: LogEvent[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (!obj || typeof obj !== "object") continue;
    const record = obj as Record<string, unknown>;

    if (record.type === "event_msg") {
      const payload =
        record.payload && typeof record.payload === "object"
          ? (record.payload as Record<string, unknown>)
          : null;
      if (
        payload?.type === "agent_message" &&
        typeof payload.message === "string"
      ) {
        events.push({ type: "assistant-text", text: payload.message });
      }
      continue;
    }

    if (record.type !== "response_item") continue;

    const payload =
      record.payload && typeof record.payload === "object"
        ? (record.payload as Record<string, unknown>)
        : null;
    if (!payload) continue;

    if (
      payload.type === "message" &&
      payload.role === "assistant" &&
      Array.isArray(payload.content)
    ) {
      const parts = collectCodexText(payload.content);
      for (const text of parts) {
        events.push({ type: "assistant-text", text });
      }
      continue;
    }

    if (payload.type === "function_call" && typeof payload.name === "string") {
      events.push({
        type: "tool-use",
        name: payload.name,
        input: parseCodexFunctionInput(payload.arguments),
      });
    }
  }

  return events;
}

export function parseSessionJsonl(
  content: string,
  provider = "claude",
): LogEvent[] {
  return provider === "codex"
    ? parseCodexSessionJsonl(content)
    : parseClaudeSessionJsonl(content);
}

export async function readSessionEvents(
  worktree: string,
  session: SessionLogReference,
): Promise<LogEvent[]> {
  const path = await resolveSessionPath(worktree, session);
  if (!path) return [];

  try {
    const content = await readFile(path, "utf-8");
    return parseSessionJsonl(content, session.provider);
  } catch {
    return [];
  }
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
        sessionId: event.sessionId,
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
