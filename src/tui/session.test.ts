import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import {
  buildResumeCommand,
  copyResumeCommandToClipboard,
  copyTextToClipboard,
} from "./session.js";

const mockExecSync = vi.mocked(execSync);

describe("session helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockExecSync.mockReset();
  });

  it("builds a Claude resume command", () => {
    expect(
      buildResumeCommand({ provider: "claude", sessionId: "session-123" }),
    ).toBe("claude --resume session-123");
  });

  it("builds a Codex resume command", () => {
    expect(
      buildResumeCommand({ provider: "codex", sessionId: "thread-123" }),
    ).toBe("codex resume thread-123");
  });

  it("returns true when a clipboard command succeeds", () => {
    mockExecSync.mockReturnValue(Buffer.alloc(0));

    expect(copyTextToClipboard("hello")).toBe(true);
    expect(mockExecSync).toHaveBeenCalled();
  });

  it("falls back through clipboard commands and returns false when none work", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("missing clipboard tool");
    });

    expect(copyTextToClipboard("hello")).toBe(false);
    expect(mockExecSync).toHaveBeenCalled();
  });

  it("copies the resume command for a session", () => {
    mockExecSync.mockReturnValue(Buffer.alloc(0));

    expect(
      copyResumeCommandToClipboard({
        provider: "codex",
        sessionId: "thread-456",
      }),
    ).toBe(true);
    expect(mockExecSync).toHaveBeenCalled();
  });
});
