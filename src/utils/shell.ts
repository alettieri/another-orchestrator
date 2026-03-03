import { spawn } from "node:child_process";

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface StreamingOptions extends ExecOptions {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export function execCommand(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ShellResult> {
  return execCommandStreaming(command, args, options);
}

export function execCommandStreaming(
  command: string,
  args: string[] = [],
  options: StreamingOptions = {},
): Promise<ShellResult> {
  if (options.signal?.aborted) {
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 130 });
  }

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let killed = false;

    child.stdout?.on("data", (data: Buffer) => {
      const str = data.toString();
      stdout += str;
      options.onStdout?.(str);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const str = data.toString();
      stderr += str;
      options.onStderr?.(str);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
    }

    let aborted = false;
    if (options.signal) {
      const onAbort = () => {
        aborted = true;
        options.onStderr?.(
          `Killing child process (pid=${child.pid}) via abort signal\n`,
        );
        child.kill("SIGTERM");
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      // Re-check after adding listener to close the race window
      if (options.signal.aborted) {
        onAbort();
      }
    }

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (aborted) {
        resolve({ stdout, stderr, exitCode: 130 });
        return;
      }
      resolve({
        stdout,
        stderr: killed ? `${stderr}Process timed out` : stderr,
        exitCode: killed ? 1 : (code ?? 1),
      });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout,
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}
