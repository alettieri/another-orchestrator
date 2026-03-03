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

  it("writes structured JSON to per-ticket log file", async () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-1" });
    child.info("test message");
    // Wait for async file write
    await new Promise((r) => setTimeout(r, 200));
    const content = await readFile(join(logDir, "ticket-1.log"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ticketId).toBe("ticket-1");
    expect(parsed.msg).toBe("test message");
    expect(parsed.level).toBe(30); // pino info level
  });

  it("writes warn-level entries to per-ticket log file", async () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-2" });
    child.warn("warning message");
    await new Promise((r) => setTimeout(r, 200));
    const content = await readFile(join(logDir, "ticket-2.log"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.level).toBe(40); // pino warn level
    expect(parsed.msg).toBe("warning message");
  });

  it("writes error-level entries to per-ticket log file", async () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-3" });
    child.error("error message");
    await new Promise((r) => setTimeout(r, 200));
    const content = await readFile(join(logDir, "ticket-3.log"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.level).toBe(50); // pino error level
    expect(parsed.msg).toBe("error message");
  });

  it("writes success-level entries to per-ticket log file", async () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-4" });
    child.success("success message");
    await new Promise((r) => setTimeout(r, 200));
    const content = await readFile(join(logDir, "ticket-4.log"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.level).toBe(35); // custom success level
    expect(parsed.msg).toBe("success message");
  });

  it("writes trace-level entries to per-ticket log file", async () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-5" });
    child.trace("agent output data");
    await new Promise((r) => setTimeout(r, 200));
    const content = await readFile(join(logDir, "ticket-5.log"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.level).toBe(10); // pino trace level
    expect(parsed.msg).toBe("agent output data");
  });

  it("does not create a log file when no ticketId binding", async () => {
    const logger = createLogger(logDir);
    logger.info("no ticket");
    await new Promise((r) => setTimeout(r, 200));
    await expect(
      readFile(join(logDir, "undefined.log"), "utf-8"),
    ).rejects.toThrow();
  });

  it("writes multiple entries to the same ticket log file", async () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-6" });
    child.info("first");
    child.warn("second");
    child.error("third");
    await new Promise((r) => setTimeout(r, 200));
    const content = await readFile(join(logDir, "ticket-6.log"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).msg).toBe("first");
    expect(JSON.parse(lines[1]).msg).toBe("second");
    expect(JSON.parse(lines[2]).msg).toBe("third");
  });

  it("child logger supports further nesting", () => {
    const logger = createLogger(logDir);
    const child = logger.child({ ticketId: "ticket-7" });
    const grandchild = child.child({ phase: "build" });
    expect(typeof grandchild.info).toBe("function");
    // Should not throw
    grandchild.info("nested log");
  });
});
