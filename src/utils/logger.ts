import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import pretty from "pino-pretty";

export type Logger = pino.Logger<"success">;

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

  const fileDest = pino.destination({
    dest: join(logDir, "orchestrator.log"),
    append: true,
    sync: false,
  });

  const streams = pino.multistream([
    { stream: prettyStream, level: "info" },
    { stream: fileDest, level: "trace" },
  ]);

  return pino<"success">(
    {
      customLevels: { success: 35 },
      level: "trace",
    },
    streams,
  );
}
