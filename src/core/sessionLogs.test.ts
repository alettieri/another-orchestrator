import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolvePlanSessionsDir,
  resolveSessionLogPath,
  resolveTicketSessionsDir,
} from "./sessionLogs.js";

describe("session log path helpers", () => {
  it("resolves the plan sessions directory", () => {
    expect(resolvePlanSessionsDir("/state", "plan-1")).toBe(
      join("/state", "plans", "plan-1", "sessions"),
    );
  });

  it("resolves the ticket sessions directory", () => {
    expect(resolveTicketSessionsDir("/state", "plan-1", "t-1")).toBe(
      join("/state", "plans", "plan-1", "sessions", "t-1"),
    );
  });

  it("resolves the per-session JSONL file path", () => {
    expect(resolveSessionLogPath("/state", "plan-1", "t-1", "sess-123")).toBe(
      join("/state", "plans", "plan-1", "sessions", "t-1", "sess-123.jsonl"),
    );
  });
});
