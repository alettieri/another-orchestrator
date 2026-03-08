import type { AgentConfig } from "../core/types.js";
import { execCommandStreaming } from "../utils/shell.js";

export interface AgentInvocation {
  prompt: string;
  cwd?: string;
  allowedTools?: string[];
  maxTurns?: number;
}

export interface AgentResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  sessionId?: string;
}

export interface AgentCallbacks {
  onOutput?: (chunk: string) => void;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function buildAgentArgs(
  agentConfig: AgentConfig,
  invocation: AgentInvocation,
): { command: string; args: string[] } {
  const { command, defaultArgs } = agentConfig;
  const { prompt, allowedTools, maxTurns } = invocation;

  if (command === "claude") {
    const args = ["-p", prompt, "--output-format", "json", ...defaultArgs];
    if (allowedTools?.length) {
      args.push("--allowedTools", ...allowedTools);
    }
    if (maxTurns !== undefined) {
      args.push("--max-turns", String(maxTurns));
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

export function parseClaudeJsonOutput(raw: string): {
  text: string;
  sessionId?: string;
} {
  try {
    const json = JSON.parse(raw);
    const text = typeof json.result === "string" ? json.result : raw;
    const sessionId =
      typeof json.session_id === "string" ? json.session_id : undefined;
    return { text, sessionId };
  } catch {
    return { text: raw };
  }
}

export async function invokeAgent(
  agentConfig: AgentConfig,
  invocation: AgentInvocation,
  callbacks?: AgentCallbacks,
  options?: { signal?: AbortSignal },
): Promise<AgentResult> {
  const { command, args } = buildAgentArgs(agentConfig, invocation);

  const result = await execCommandStreaming(command, args, {
    cwd: invocation.cwd || undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    onStdout: callbacks?.onOutput,
    signal: options?.signal,
  });

  if (agentConfig.command === "claude") {
    const parsed = parseClaudeJsonOutput(result.stdout);
    return {
      stdout: parsed.text,
      stderr: result.stderr,
      exitCode: result.exitCode,
      success: result.exitCode === 0,
      sessionId: parsed.sessionId,
    };
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    success: result.exitCode === 0,
  };
}
