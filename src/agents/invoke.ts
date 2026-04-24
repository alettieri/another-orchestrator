import type { SessionLogEventInput } from "../core/sessionLogWriter.js";
import type { AgentConfig, AgentSession, JsonValue } from "../core/types.js";
import { execCommandStreaming } from "../utils/shell.js";

export interface AgentInvocation {
  prompt: string;
  cwd?: string;
  allowedTools?: string[];
  timeoutMs?: number;
}

export interface AgentResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  session?: AgentSession;
}

export interface AgentCallbacks {
  onOutput?: (chunk: string) => void;
  onSession?: (session: AgentSession) => void | Promise<void>;
  onSessionLogEvent?: (event: SessionLogEventInput) => void | Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

interface StreamParser {
  feed(chunk: string): void;
  end(): void;
  readonly session: AgentSession | undefined;
  readonly finalText: string | undefined;
}

export function buildAgentArgs(
  agentConfig: AgentConfig,
  invocation: AgentInvocation,
): { command: string; args: string[] } {
  const { command, defaultArgs } = agentConfig;
  const { prompt, allowedTools } = invocation;

  if (command === "claude") {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      ...defaultArgs,
    ];
    if (allowedTools?.length) {
      args.push("--allowedTools", ...allowedTools);
    }
    return { command, args };
  }

  if (command === "codex") {
    const args = ["exec", "--json", prompt, ...defaultArgs];
    return { command, args };
  }

  // Generic agent: command "<prompt>" + defaultArgs
  const args = [prompt, ...defaultArgs];
  return { command, args };
}

export function createClaudeStreamParser(options?: {
  onSession?: (session: AgentSession) => void | Promise<void>;
  onSessionLogEvent?: (event: SessionLogEventInput) => void | Promise<void>;
}) {
  let session: AgentSession | undefined;
  let finalText: string | undefined;
  const toolNamesByCallId = new Map<string, string>();

  const emit = (event: SessionLogEventInput): void => {
    if (!session) return;
    void options?.onSessionLogEvent?.(event);
  };

  return createJsonLineStreamParser(
    (event) => {
      if (
        session === undefined &&
        event.type === "system" &&
        event.subtype === "init" &&
        typeof event.session_id === "string"
      ) {
        session = { id: event.session_id, provider: "claude" };
        void options?.onSession?.(session);
        emit({ type: "session-start" });
        return;
      }

      if (event.type === "result" && typeof event.result === "string") {
        finalText = event.result;
      }

      if (!session) return;

      if (event.type === "assistant") {
        const message = event.message;
        if (!message || typeof message !== "object") return;
        const content = (message as Record<string, unknown>).content;
        if (!Array.isArray(content)) return;

        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;

          if (b.type === "text" && typeof b.text === "string") {
            emit({ type: "assistant-text", text: b.text });
            continue;
          }

          if (b.type === "tool_use") {
            const callId = b.id;
            const toolName = b.name;
            if (typeof callId !== "string" || typeof toolName !== "string") {
              continue;
            }
            toolNamesByCallId.set(callId, toolName);
            emit({
              type: "tool-use",
              callId,
              toolName,
              input: (b.input ?? null) as JsonValue,
            });
          }
        }
        return;
      }

      if (event.type === "user") {
        const message = event.message;
        if (!message || typeof message !== "object") return;
        const content = (message as Record<string, unknown>).content;
        if (!Array.isArray(content)) return;

        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type !== "tool_result") continue;

          const callId = b.tool_use_id;
          if (typeof callId !== "string") continue;

          const toolName =
            toolNamesByCallId.get(callId) ??
            (typeof b.name === "string" ? b.name : "unknown");
          const isError =
            typeof b.is_error === "boolean"
              ? b.is_error
              : typeof b.isError === "boolean"
                ? b.isError
                : false;

          emit({
            type: "tool-result",
            callId,
            toolName,
            result: (b.content ?? b.result ?? b.output ?? null) as JsonValue,
            isError,
          });
        }
      }
    },
    {
      get session() {
        return session;
      },
      get finalText() {
        return finalText;
      },
    },
  );
}

export function createCodexStreamParser(options?: {
  onSession?: (session: AgentSession) => void | Promise<void>;
  onSessionLogEvent?: (event: SessionLogEventInput) => void | Promise<void>;
}) {
  let session: AgentSession | undefined;
  let finalText: string | undefined;

  const emit = (event: SessionLogEventInput): void => {
    if (!session) return;
    void options?.onSessionLogEvent?.(event);
  };

  return createJsonLineStreamParser(
    (event) => {
      if (
        event.type === "item.completed" &&
        event.item &&
        typeof event.item === "object"
      ) {
        const item = event.item as Record<string, unknown>;
        if (item.type === "agent_message" && typeof item.text === "string") {
          finalText = item.text;
          emit({ type: "assistant-text", text: item.text });
          return;
        }
      }

      if (
        session === undefined &&
        event.type === "thread.started" &&
        typeof event.thread_id === "string"
      ) {
        session = { id: event.thread_id, provider: "codex" };
        void options?.onSession?.(session);
        emit({ type: "session-start" });
        return;
      }

      if (!session) return;

      if (event.type !== "item.started" && event.type !== "item.completed") {
        return;
      }
      if (!event.item || typeof event.item !== "object") return;

      const item = event.item as Record<string, unknown>;

      if (item.type !== "command_execution") return;

      const callId = item.id;
      if (typeof callId !== "string") return;

      const toolName =
        typeof item.toolName === "string"
          ? item.toolName
          : typeof item.name === "string"
            ? item.name
            : "command_execution";

      if (event.type === "item.started") {
        emit({
          type: "tool-use",
          callId,
          toolName,
          input: (item.input ?? item.command ?? item) as JsonValue,
        });
        return;
      }

      const isError =
        typeof item.is_error === "boolean"
          ? item.is_error
          : typeof item.isError === "boolean"
            ? item.isError
            : typeof item.success === "boolean"
              ? !item.success
              : typeof item.exit_code === "number"
                ? item.exit_code !== 0
                : false;

      emit({
        type: "tool-result",
        callId,
        toolName,
        result: (item.result ?? item.output ?? item) as JsonValue,
        isError,
      });
    },
    {
      get session() {
        return session;
      },
      get finalText() {
        return finalText;
      },
    },
  );
}

function createJsonLineStreamParser(
  onEvent: (event: Record<string, unknown>) => void,
  state: Pick<StreamParser, "session" | "finalText">,
): StreamParser {
  let buffer = "";

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (!event || typeof event !== "object") return;
    onEvent(event as Record<string, unknown>);
  }

  return {
    feed(chunk: string): void {
      buffer += chunk;
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx !== -1) {
        handleLine(buffer.slice(0, newlineIdx));
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf("\n");
      }
    },
    end(): void {
      if (buffer.length > 0) {
        handleLine(buffer);
        buffer = "";
      }
    },
    get session() {
      return state.session;
    },
    get finalText() {
      return state.finalText;
    },
  };
}

export async function invokeAgent(
  agentConfig: AgentConfig,
  invocation: AgentInvocation,
  callbacks?: AgentCallbacks,
  options?: { signal?: AbortSignal },
): Promise<AgentResult> {
  const { command, args } = buildAgentArgs(agentConfig, invocation);
  const parser =
    agentConfig.command === "claude"
      ? createClaudeStreamParser({
          onSession: callbacks?.onSession,
          onSessionLogEvent: callbacks?.onSessionLogEvent,
        })
      : agentConfig.command === "codex"
        ? createCodexStreamParser({
            onSession: callbacks?.onSession,
            onSessionLogEvent: callbacks?.onSessionLogEvent,
          })
        : undefined;

  const result = await execCommandStreaming(command, args, {
    cwd: invocation.cwd || undefined,
    timeoutMs: invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    onStdout: parser
      ? (chunk) => {
          callbacks?.onOutput?.(chunk);
          parser.feed(chunk);
        }
      : callbacks?.onOutput,
    signal: options?.signal,
  });

  parser?.end();

  if (
    agentConfig.command === "codex" &&
    result.exitCode === 0 &&
    parser?.session === undefined
  ) {
    console.warn("Codex completed successfully without emitting a thread_id");
  }

  return {
    stdout: parser?.finalText ?? result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    success: result.exitCode === 0,
    session: parser?.session,
  };
}
