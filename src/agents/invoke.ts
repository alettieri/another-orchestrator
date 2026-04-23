import {
  type AgentConfig,
  type AgentSession,
  AgentSessionSchema,
} from "../core/types.js";
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
  session?: AgentSession;
}

export interface AgentCallbacks {
  onOutput?: (chunk: string) => void;
  onSessionId?: (sessionId: string) => void | Promise<void>;
  onSession?: (session: AgentSession) => void | Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

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
    const args = ["exec", prompt, ...defaultArgs];
    return { command, args };
  }

  // Generic agent: command "<prompt>" + defaultArgs
  const args = [prompt, ...defaultArgs];
  return { command, args };
}

export function createClaudeStreamParser(options?: {
  onSessionId?: (sessionId: string) => void | Promise<void>;
  onSession?: (session: AgentSession) => void | Promise<void>;
}) {
  let buffer = "";
  let sessionId: string | undefined;
  let session: AgentSession | undefined;
  let finalText: string | undefined;

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
    const e = event as Record<string, unknown>;

    if (
      sessionId === undefined &&
      e.type === "system" &&
      e.subtype === "init" &&
      typeof e.session_id === "string"
    ) {
      sessionId = e.session_id;
      session = AgentSessionSchema.parse({ id: sessionId });
      void options?.onSessionId?.(sessionId);
      void options?.onSession?.(session);
      return;
    }

    if (e.type === "result" && typeof e.result === "string") {
      finalText = e.result;
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

export async function invokeAgent(
  agentConfig: AgentConfig,
  invocation: AgentInvocation,
  callbacks?: AgentCallbacks,
  options?: { signal?: AbortSignal },
): Promise<AgentResult> {
  const { command, args } = buildAgentArgs(agentConfig, invocation);

  if (agentConfig.command === "claude") {
    const parser = createClaudeStreamParser({
      onSessionId: callbacks?.onSessionId,
      onSession: callbacks?.onSession,
    });

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
