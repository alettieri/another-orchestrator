import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execCommand, execCommandStreaming } from "./shell.js";

describe("shell", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "shell-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("execCommand", () => {
    it("captures stdout from echo", async () => {
      const result = await execCommand("echo", ["hello world"]);
      expect(result.stdout.trim()).toBe("hello world");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("captures stderr", async () => {
      const result = await execCommand("bash", [
        "-c",
        "echo error >&2; exit 0",
      ]);
      expect(result.stderr.trim()).toBe("error");
      expect(result.exitCode).toBe(0);
    });

    it("returns non-zero exit code without rejecting", async () => {
      const result = await execCommand("bash", ["-c", "exit 42"]);
      expect(result.exitCode).toBe(42);
    });

    it("respects cwd option", async () => {
      const { realpathSync } = await import("node:fs");
      const result = await execCommand("pwd", [], { cwd: tmpDir });
      expect(result.stdout.trim()).toBe(realpathSync(tmpDir));
      expect(result.exitCode).toBe(0);
    });

    it("passes env variables", async () => {
      const result = await execCommand("bash", ["-c", "echo $TEST_VAR"], {
        env: { TEST_VAR: "hello_env" },
      });
      expect(result.stdout.trim()).toBe("hello_env");
    });

    it("handles timeout by killing process", async () => {
      const result = await execCommand("sleep", ["10"], { timeoutMs: 100 });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("timed out");
    });

    it("handles command not found", async () => {
      const result = await execCommand("nonexistent_cmd_xyz_12345");
      expect(result.exitCode).toBe(1);
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it("runs a script file", async () => {
      const scriptPath = join(tmpDir, "test.sh");
      await writeFile(scriptPath, '#!/usr/bin/env bash\necho "from script"', {
        mode: 0o755,
      });
      const result = await execCommand("bash", [scriptPath]);
      expect(result.stdout.trim()).toBe("from script");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("execCommandStreaming", () => {
    it("calls onStdout callback", async () => {
      const chunks: string[] = [];
      const result = await execCommandStreaming("echo", ["streaming test"], {
        onStdout: (data) => chunks.push(data),
      });
      expect(result.stdout.trim()).toBe("streaming test");
      expect(chunks.join("").trim()).toBe("streaming test");
    });

    it("calls onStderr callback", async () => {
      const errChunks: string[] = [];
      const result = await execCommandStreaming(
        "bash",
        ["-c", "echo err_msg >&2"],
        {
          onStderr: (data) => errChunks.push(data),
        },
      );
      expect(errChunks.join("").trim()).toBe("err_msg");
      expect(result.stderr.trim()).toBe("err_msg");
    });

    it("captures both stdout and stderr with callbacks", async () => {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const result = await execCommandStreaming(
        "bash",
        ["-c", "echo out; echo err >&2"],
        {
          onStdout: (data) => stdoutChunks.push(data),
          onStderr: (data) => stderrChunks.push(data),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(stdoutChunks.join("").trim()).toBe("out");
      expect(stderrChunks.join("").trim()).toBe("err");
    });

    it("kills child process when AbortSignal is fired", async () => {
      const controller = new AbortController();

      // Start a long-running process
      const promise = execCommandStreaming("sleep", ["10"], {
        signal: controller.signal,
      });

      // Abort after a short delay
      setTimeout(() => controller.abort(), 100);

      const result = await promise;
      expect(result.exitCode).toBe(130);
    });

    it("resolves immediately when AbortSignal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const start = Date.now();
      const result = await execCommandStreaming("sleep", ["10"], {
        signal: controller.signal,
      });
      const elapsed = Date.now() - start;

      expect(result.exitCode).toBe(130);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
