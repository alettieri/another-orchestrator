import { basename } from "node:path";
import type { AgentConfig } from "../core/types.js";
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
  sessionId?: string;
  session?: {
    provider: string;
    sessionId: string | null;
    threadId: string | null;
  };
}

export interface AgentCallbacks {
  onOutput?: (chunk: string) => void;
  onSessionId?: (sessionId: string) => void | Promise<void>;
  onSession?: (session: {
    provider: string;
    sessionId: string | null;
    threadId: string | null;
  }) => void | Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

interface ParsedSessionMetadata {
  provider: string;
  sessionId: string | null;
  threadId: string | null;
}

interface StreamAdapter {
  buildArgs(
    agentConfig: AgentConfig,
    invocation: AgentInvocation,
  ): { command: string; args: string[] };
  createParser?(callbacks?: AgentCallbacks): {
    feed(chunk: string): void;
    end(): void;
    flushCallbacks(): Promise<void>;
    readonly sessionId: string | undefined;
    readonly session: ParsedSessionMetadata | undefined;
    readonly finalText: string | undefined;
  };
}

function getProviderCommand(command: string): string {
  return basename(command);
}

function toCanonicalSessionId(
  session: ParsedSessionMetadata | undefined,
): string | undefined {
  return session?.sessionId ?? session?.threadId ?? undefined;
}

function getString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const candidate = record[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function collectTextParts(value: unknown): string[] {
  if (typeof value === "string") {
    return value.length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextParts(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (
    (type === "text" || type === "output_text") &&
    typeof record.text === "string"
  ) {
    return record.text.length > 0 ? [record.text] : [];
  }

  const content = record.content;
  if (content !== undefined) {
    return collectTextParts(content);
  }

  if (typeof record.text === "string") {
    return record.text.length > 0 ? [record.text] : [];
  }

  if (record.message !== undefined) {
    return collectTextParts(record.message);
  }

  if (record.output !== undefined) {
    return collectTextParts(record.output);
  }

  if (record.response !== undefined) {
    return collectTextParts(record.response);
  }

  return [];
}

function createJsonLineStreamParser(
  callbacks: AgentCallbacks | undefined,
  handleEvent: (
    event: Record<string, unknown>,
    current: {
      session?: ParsedSessionMetadata;
      finalText?: string;
    },
  ) => {
    session?: ParsedSessionMetadata;
    finalText?: string;
  },
) {
  let buffer = "";
  let session: ParsedSessionMetadata | undefined;
  let sessionId: string | undefined;
  let finalText: string | undefined;

  function emitSession(nextSession: ParsedSessionMetadata): void {
    const changed =
      session?.provider !== nextSession.provider ||
      session?.sessionId !== nextSession.sessionId ||
      session?.threadId !== nextSession.threadId;
    if (!changed) return;

    session = nextSession;
    callbacks?.onSession?.(nextSession);

    const nextSessionId = toCanonicalSessionId(nextSession);
    if (nextSessionId && nextSessionId !== sessionId) {
      sessionId = nextSessionId;
      callbacks?.onSessionId?.(nextSessionId);
    }
  }

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
    const update = handleEvent(event as Record<string, unknown>, {
      session,
      finalText,
    });
    if (update.session) {
      emitSession(update.session);
    }
    if (update.finalText !== undefined) {
      finalText = update.finalText;
    }
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
    async flushCallbacks(): Promise<void> {
      await Promise.resolve();
    },
    get sessionId() {
      return sessionId;
    },
    get session() {
      return session;
    },
    get finalText() {
      return finalText;
    },
  };
}

function serializeAgentCallbacks(callbacks: AgentCallbacks | undefined): {
  callbacks: AgentCallbacks | undefined;
  flush: () => Promise<void>;
} {
  if (!callbacks) {
    return {
      callbacks: undefined,
      flush: async () => {
        await Promise.resolve();
      },
    };
  }

  let queue = Promise.resolve();
  const enqueue = (callback: (() => void | Promise<void>) | undefined) => {
    if (!callback) return;
    queue = queue
      .then(async () => {
        await callback();
      })
      .catch(() => {});
  };

  return {
    callbacks: {
      onOutput: callbacks.onOutput,
      onSession: callbacks.onSession
        ? (session) => {
            enqueue(() => callbacks.onSession?.(session));
          }
        : undefined,
      onSessionId: callbacks.onSessionId
        ? (sessionId) => {
            enqueue(() => callbacks.onSessionId?.(sessionId));
          }
        : undefined,
    },
    flush: async () => {
      await queue;
    },
  };
}

const streamAdapters: Record<string, StreamAdapter> = {
  claude: {
    buildArgs(agentConfig, invocation) {
      const { prompt, allowedTools } = invocation;
      const args = [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        ...agentConfig.defaultArgs,
      ];
      if (allowedTools?.length) {
        args.push("--allowedTools", ...allowedTools);
      }
      return { command: agentConfig.command, args };
    },
    createParser(callbacks) {
      return createClaudeStreamParser(callbacks);
    },
  },
  codex: {
    buildArgs(agentConfig, invocation) {
      return {
        command: agentConfig.command,
        args: ["exec", "--json", invocation.prompt, ...agentConfig.defaultArgs],
      };
    },
    createParser(callbacks) {
      return createCodexStreamParser(callbacks);
    },
  },
};

export function buildAgentArgs(
  agentConfig: AgentConfig,
  invocation: AgentInvocation,
): { command: string; args: string[] } {
  const provider = getProviderCommand(agentConfig.command);
  const adapter = streamAdapters[provider];
  if (adapter) {
    return adapter.buildArgs(agentConfig, invocation);
  }

  // Generic agent: command "<prompt>" + defaultArgs
  const args = [invocation.prompt, ...agentConfig.defaultArgs];
  return { command: agentConfig.command, args };
}

export function createClaudeStreamParser(callbacks?: AgentCallbacks) {
  return createJsonLineStreamParser(callbacks, (event, current) => {
    if (
      current.session === undefined &&
      event.type === "system" &&
      event.subtype === "init" &&
      typeof event.session_id === "string"
    ) {
      return {
        session: {
          provider: "claude",
          sessionId: event.session_id,
          threadId: null,
        },
      };
    }

    if (event.type === "result" && typeof event.result === "string") {
      return { finalText: event.result };
    }

    return {};
  });
}

export function createCodexStreamParser(callbacks?: AgentCallbacks) {
  return createJsonLineStreamParser(callbacks, (event, current) => {
    const nextSessionId =
      getString(event, "session_id") ??
      getString(event, "sessionId") ??
      getString(event.session, "id");
    const nextThreadId =
      getString(event, "thread_id") ??
      getString(event, "threadId") ??
      getString(event.thread, "id");
    const sessionId = nextSessionId ?? current.session?.sessionId ?? null;
    const threadId = nextThreadId ?? current.session?.threadId ?? null;

    let finalText: string | undefined;
    const type = typeof event.type === "string" ? event.type : undefined;
    const role = getString(event, "role") ?? getString(event.message, "role");
    if (typeof event.final_output === "string") {
      finalText = event.final_output;
    } else if (
      type === "message" ||
      type === "assistant_message" ||
      type === "response.completed" ||
      role === "assistant"
    ) {
      const text = collectTextParts(event);
      if (text.length > 0) {
        finalText = text.join("\n");
      }
    }

    return {
      session:
        nextSessionId || nextThreadId || current.session
          ? {
              provider: "codex",
              sessionId,
              threadId,
            }
          : undefined,
      finalText,
    };
  });
}

export async function invokeAgent(
  agentConfig: AgentConfig,
  invocation: AgentInvocation,
  callbacks?: AgentCallbacks,
  options?: { signal?: AbortSignal },
): Promise<AgentResult> {
  const { command, args } = buildAgentArgs(agentConfig, invocation);
  const provider = getProviderCommand(agentConfig.command);
  const adapter = streamAdapters[provider];
  const serializedCallbacks = serializeAgentCallbacks(callbacks);
  const parser = adapter?.createParser?.(serializedCallbacks.callbacks);

  if (parser) {
    const result = await execCommandStreaming(command, args, {
      cwd: invocation.cwd || undefined,
      timeoutMs: invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onStdout: (chunk) => {
        callbacks?.onOutput?.(chunk);
        parser.feed(chunk);
      },
      signal: options?.signal,
    });

    parser.end();
    await parser.flushCallbacks();
    await serializedCallbacks.flush();

    return {
      stdout: parser.finalText ?? result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      success: result.exitCode === 0,
      sessionId: parser.sessionId,
      session: parser.session,
    };
  }

  const result = await execCommandStreaming(command, args, {
    cwd: invocation.cwd || undefined,
    timeoutMs: invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    onStdout: callbacks?.onOutput,
    signal: options?.signal,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    success: result.exitCode === 0,
  };
}
