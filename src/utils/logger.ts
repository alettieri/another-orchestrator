import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import pretty from "pino-pretty";

export type Logger = pino.Logger<"success">;

const MAX_OPEN_STREAMS = 64;

/**
 * Map from Logger instance to its TicketFileRouter, used by flushLogger().
 */
const routerMap = new WeakMap<Logger, TicketFileRouter>();

/**
 * Routes pino JSON log lines to per-ticket files based on the ticketId binding.
 * Lines without a ticketId are silently dropped.
 *
 * Implements line buffering to handle partial chunks and LRU-style eviction
 * to prevent file descriptor exhaustion in long-running processes.
 */
class TicketFileRouter extends Writable {
  private fileStreams = new Map<string, WriteStream>();
  private buffer = "";

  constructor(private logDir: string) {
    super();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    // Keep the last (possibly incomplete) segment in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const ticketId = parsed.ticketId;
        if (!ticketId) continue;
        const stream = this.getOrCreateStream(ticketId);
        stream.write(`${line}\n`);
      } catch (err) {
        console.error(`[TicketFileRouter] Failed to parse log line: ${err}`);
      }
    }
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    // Process any remaining buffered data
    if (this.buffer.trim()) {
      try {
        const parsed = JSON.parse(this.buffer);
        const ticketId = parsed.ticketId;
        if (ticketId) {
          const stream = this.getOrCreateStream(ticketId);
          stream.write(`${this.buffer}\n`);
        }
      } catch {
        // Ignore incomplete final chunk
      }
      this.buffer = "";
    }

    const closePromises = Array.from(this.fileStreams.values()).map(
      (stream) => new Promise<void>((resolve) => stream.end(() => resolve())),
    );
    Promise.all(closePromises)
      .then(() => {
        this.fileStreams.clear();
        callback(null);
      })
      .catch(callback);
  }

  private getOrCreateStream(ticketId: string): WriteStream {
    const safeId = ticketId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    let stream = this.fileStreams.get(safeId);
    if (!stream) {
      this.evictOldest();
      const filePath = join(this.logDir, `${safeId}.log`);
      stream = createWriteStream(filePath, { flags: "a" });
      this.fileStreams.set(safeId, stream);
    }
    return stream;
  }

  /**
   * Close the oldest stream when we've reached the maximum number of open streams.
   */
  private evictOldest(): void {
    if (this.fileStreams.size < MAX_OPEN_STREAMS) return;
    const oldestKey = this.fileStreams.keys().next().value;
    if (oldestKey !== undefined) {
      const oldStream = this.fileStreams.get(oldestKey);
      oldStream?.end();
      this.fileStreams.delete(oldestKey);
    }
  }
}

export function createLogger(logDir: string): Logger {
  mkdirSync(logDir, { recursive: true });

  const prettyStream = pretty({
    colorize: true,
    ignore: "pid,hostname,ticketId",
    translateTime: "SYS:HH:mm:ss",
    customLevels: "success:35",
    customColors: "success:green",
    messageFormat: (log: Record<string, unknown>, messageKey: string) => {
      const tag = log.ticketId ? `[${log.ticketId}] ` : "";
      return `${tag}${log[messageKey]}`;
    },
  });

  const fileRouter = new TicketFileRouter(logDir);

  const streams = pino.multistream([
    { stream: prettyStream, level: "info" },
    { stream: fileRouter, level: "trace" },
  ]);

  const pinoLogger = pino<"success">(
    {
      customLevels: { success: 35 },
      level: "trace",
    },
    streams,
  );

  routerMap.set(pinoLogger, fileRouter);

  return pinoLogger;
}

/**
 * Flush and close all file streams associated with a logger.
 * Useful in tests to ensure all writes complete before assertions.
 */
export function flushLogger(logger: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    const router = routerMap.get(logger);
    if (!router) {
      resolve();
      return;
    }
    router.end((err: Error | null | undefined) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
