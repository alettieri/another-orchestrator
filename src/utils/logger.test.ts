import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
  let logDir: string;

  beforeEach(() => {
    logDir = join(
      tmpdir(),
      `logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await rm(logDir, { recursive: true, force: true });
  });

  it("has all expected methods", () => {
    const logger = createLogger(logDir);
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.success).toBe("function");
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("child logger has the same methods", () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-1" });
    expect(typeof child.info).toBe("function");
    expect(typeof child.warn).toBe("function");
    expect(typeof child.error).toBe("function");
    expect(typeof child.success).toBe("function");
    expect(typeof child.trace).toBe("function");
    expect(typeof child.child).toBe("function");
  });

  it("writes structured JSON to log file with ticketId in metadata", async () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-1" });
    child.info("test message");
    await logger.flush();
    const content = await readFile(join(logDir, "orchestrator.log"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ticketId).toBe("ticket-1");
    expect(parsed.msg).toBe("test message");
    expect(parsed.level).toBe(30);
  });

  it("writes entries from different tickets to the same log file", async () => {
    const logger = createLogger(logDir);
    const child1 = logger.child({ ticketId: "ticket-A" });
    const child2 = logger.child({ ticketId: "ticket-B" });
    child1.info("from A");
    child2.info("from B");
    await logger.flush();
    const content = await readFile(join(logDir, "orchestrator.log"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).ticketId).toBe("ticket-A");
    expect(JSON.parse(lines[1]).ticketId).toBe("ticket-B");
  });

  it("writes logs without ticketId to the log file", async () => {
    const logger = createLogger(logDir);
    logger.info("daemon message");
    await logger.flush();
    const content = await readFile(join(logDir, "orchestrator.log"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.msg).toBe("daemon message");
    expect(parsed.ticketId).toBeUndefined();
  });

  it("writes different log levels", async () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-1" });
    child.trace("trace msg");
    child.info("info msg");
    child.warn("warn msg");
    child.error("error msg");
    child.success("success msg");
    await logger.flush();
    const content = await readFile(join(logDir, "orchestrator.log"), "utf-8");
    const lines = content
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0].level).toBe(10);
    expect(lines[1].level).toBe(30);
    expect(lines[2].level).toBe(40);
    expect(lines[3].level).toBe(50);
    expect(lines[4].level).toBe(35);
  });

  it("child logger supports further nesting", () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-7" });
    const grandchild = child.child({ phase: "build" });
    expect(typeof grandchild.info).toBe("function");
    grandchild.info("nested log");
  });
});
