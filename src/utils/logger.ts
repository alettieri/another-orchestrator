import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import pretty from "pino-pretty";

export type Logger = pino.Logger<"success">;

/**
 * Routes pino JSON log lines to per-ticket files based on the ticketId binding.
 * Lines without a ticketId are silently dropped.
 */
class TicketFileRouter extends Writable {
  private fileStreams = new Map<string, WriteStream>();

  constructor(private logDir: string) {
    super();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const line = chunk.toString();
      const parsed = JSON.parse(line);
      const ticketId = parsed.ticketId;
      if (!ticketId) {
        callback();
        return;
      }
      const stream = this.getOrCreateStream(ticketId);
      if (!stream.write(line)) {
        stream.once("drain", () => callback());
      } else {
        callback();
      }
    } catch (err) {
      console.error(`[TicketFileRouter] Failed to parse log line: ${err}`);
      callback();
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
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
    const safeId = ticketId.replace(/[^a-zA-Z0-9_-]/g, "_");
    let stream = this.fileStreams.get(safeId);
    if (!stream) {
      const filePath = join(this.logDir, `${safeId}.log`);
      stream = createWriteStream(filePath, { flags: "a" });
      this.fileStreams.set(safeId, stream);
    }
    return stream;
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

  return pinoLogger;
}
