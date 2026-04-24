import { appendFile, mkdir } from "node:fs/promises";
import {
  resolveSessionLogPath,
  resolveTicketSessionsDir,
} from "./sessionLogs.js";
import type { AgentSession, SessionLogEvent } from "./types.js";
import { SessionLogEventSchema } from "./types.js";

type WithOptionalBase<T extends { v: 1; timestamp: string }> = Omit<
  T,
  "v" | "timestamp"
> & {
  v?: 1;
  timestamp?: string;
};

type SessionStartLogEventInput = WithOptionalBase<
  Omit<
    Extract<SessionLogEvent, { type: "session-start" }>,
    "planId" | "ticketId" | "session"
  >
> & {
  planId?: string;
  ticketId?: string;
  session?: AgentSession;
};

type ToolResultLogEventInput = WithOptionalBase<
  Omit<Extract<SessionLogEvent, { type: "tool-result" }>, "isError"> & {
    isError?: boolean;
  }
>;

export type SessionLogEventInput =
  | SessionStartLogEventInput
  | WithOptionalBase<Extract<SessionLogEvent, { type: "assistant-text" }>>
  | WithOptionalBase<Extract<SessionLogEvent, { type: "tool-use" }>>
  | ToolResultLogEventInput
  | WithOptionalBase<Extract<SessionLogEvent, { type: "warning" }>>;

export interface SessionLogWriter {
  readonly planId: string;
  readonly ticketId: string;
  readonly session: AgentSession;
  readonly path: string;
  append(event: SessionLogEventInput): Promise<void>;
}

type SessionLogWriterScope = {
  planId: string;
  ticketId: string;
  session: AgentSession;
};

function normalizeEvent(
  event: SessionLogEventInput,
  scope: SessionLogWriterScope,
): SessionLogEvent {
  const base: { v: 1; timestamp: string } = {
    v: 1,
    timestamp: new Date().toISOString(),
  };

  if (event.type === "session-start") {
    const merged = {
      ...base,
      ...event,
      planId: event.planId ?? scope.planId,
      ticketId: event.ticketId ?? scope.ticketId,
      session: event.session ?? scope.session,
    };

    if (merged.planId !== scope.planId) {
      throw new Error(
        `Session log writer scoped to plan "${scope.planId}", got "${merged.planId}"`,
      );
    }
    if (merged.ticketId !== scope.ticketId) {
      throw new Error(
        `Session log writer scoped to ticket "${scope.ticketId}", got "${merged.ticketId}"`,
      );
    }
    if (merged.session.id !== scope.session.id) {
      throw new Error(
        `Session log writer scoped to session "${scope.session.id}", got "${merged.session.id}"`,
      );
    }
    if (merged.session.provider !== scope.session.provider) {
      throw new Error(
        `Session log writer scoped to provider "${scope.session.provider}", got "${merged.session.provider}"`,
      );
    }

    return SessionLogEventSchema.parse(merged);
  }

  return SessionLogEventSchema.parse({ ...base, ...event });
}

export function createSessionLogWriter(opts: {
  stateDir: string;
  planId: string;
  ticketId: string;
  session: AgentSession;
}): SessionLogWriter {
  const { stateDir, planId, ticketId, session } = opts;
  const dir = resolveTicketSessionsDir(stateDir, planId, ticketId);
  const path = resolveSessionLogPath(stateDir, planId, ticketId, session.id);

  let initialized = false;
  let writeQueue: Promise<void> = Promise.resolve();

  async function appendOnce(event: SessionLogEventInput): Promise<void> {
    if (!initialized) {
      await mkdir(dir, { recursive: true });
      initialized = true;
    }
    const normalized = normalizeEvent(event, { planId, ticketId, session });
    await appendFile(path, `${JSON.stringify(normalized)}\n`, "utf-8");
  }

  function enqueue(event: SessionLogEventInput): Promise<void> {
    writeQueue = writeQueue.then(
      () => appendOnce(event),
      () => appendOnce(event),
    );
    return writeQueue;
  }

  return {
    planId,
    ticketId,
    session,
    path,
    append: enqueue,
  };
}
