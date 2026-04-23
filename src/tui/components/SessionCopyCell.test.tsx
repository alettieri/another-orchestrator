import { execSync } from "node:child_process";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { SessionCopyCell } from "./SessionCopyCell.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("SessionCopyCell", () => {
  it("shows a compact provider hint with a truncated session ID", () => {
    const { lastFrame, unmount } = render(
      <SessionCopyCell
        isSelected
        session={{ id: "abc123defghijklmnop", provider: "claude" }}
      />,
    );

    expect(lastFrame()).toContain("cl:abc123defg…");
    unmount();
  });

  it("copies a Claude resume command", () => {
    const { stdin, unmount } = render(
      <SessionCopyCell
        isSelected
        session={{ id: "claude-session", provider: "claude" }}
      />,
    );

    stdin.write("c");

    expect(execSync).toHaveBeenCalledWith("pbcopy", {
      input: "claude --resume claude-session",
    });
    unmount();
  });

  it("copies a Codex resume command", () => {
    const { stdin, unmount } = render(
      <SessionCopyCell
        isSelected
        session={{ id: "codex-session", provider: "codex" }}
      />,
    );

    stdin.write("c");

    expect(execSync).toHaveBeenCalledWith("pbcopy", {
      input: "codex resume codex-session",
    });
    unmount();
  });
});
