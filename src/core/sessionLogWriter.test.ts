import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionLogWriter } from "./sessionLogWriter.js";

describe("createSessionLogWriter", () => {
  async function createWriter() {
    const stateDir = await mkdtemp(join(tmpdir(), "orchestrator-state-"));
    return createSessionLogWriter({
      stateDir,
      planId: "plan-1",
      ticketId: "t-1",
      session: { id: "sess-1", provider: "codex" },
    });
  }

  it("creates the per-ticket sessions directory lazily", async () => {
    const writer = await createWriter();

    const sessionsDir = dirname(writer.path);
    await expect(access(sessionsDir)).rejects.toThrow();

    await writer.append({ type: "assistant-text", text: "hello" });
    await expect(access(sessionsDir)).resolves.toBeUndefined();
  });

  it("creates <sessionId>.jsonl on first write and normalizes events", async () => {
    const writer = await createWriter();

    await expect(access(writer.path)).rejects.toThrow();

    await writer.append({
      type: "tool-result",
      callId: "call-1",
      toolName: "web.run",
      result: { ok: true },
    });

    await expect(access(writer.path)).resolves.toBeUndefined();

    const content = await readFile(writer.path, "utf-8");
    const [line] = content.trim().split("\n");
    const parsed = JSON.parse(line ?? "{}") as Record<string, unknown>;
    expect(parsed.type).toBe("tool-result");
    expect(parsed.v).toBe(1);
    expect(typeof parsed.timestamp).toBe("string");
    expect(parsed.isError).toBe(false);
  });

  it("appends one JSON object per line in order", async () => {
    const writer = await createWriter();

    const p1 = writer.append({ type: "assistant-text", text: "one" });
    const p2 = writer.append({ type: "assistant-text", text: "two" });
    const p3 = writer.append({ type: "assistant-text", text: "three" });
    await Promise.all([p1, p2, p3]);

    const content = await readFile(writer.path, "utf-8");
    const lines = content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; text?: string });

    expect(lines).toHaveLength(3);
    expect(lines.map((e) => e.text)).toEqual(["one", "two", "three"]);
  });
});
