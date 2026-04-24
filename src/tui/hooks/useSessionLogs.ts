import { readFile } from "node:fs/promises";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { watch } from "chokidar";
import { useEffect, useMemo } from "react";
import { resolveSessionLogPath } from "../../core/sessionLogs.js";
import type { AgentSession, TicketState } from "../../core/types.js";
import {
  type LogEvent,
  parseNormalizedSessionJsonl,
} from "../screens/TicketLogsScreen.helpers.js";

type SessionEntry = {
  phase: string;
  session: AgentSession;
};

function sessionLogKey(planId: string, ticketId: string, sessionId: string) {
  return ["session-log", planId, ticketId, sessionId] as const;
}

export function useSessionLogs(
  ticket: TicketState,
  stateDir: string,
): LogEvent[] {
  const queryClient = useQueryClient();
  const { planId, ticketId } = ticket;

  const sessionEntries = useMemo(() => {
    const entries: SessionEntry[] = [];
    const seen = new Set<string>();

    for (const entry of ticket.phaseHistory) {
      if (entry.session && !seen.has(entry.session.id)) {
        entries.push({ phase: entry.phase, session: entry.session });
        seen.add(entry.session.id);
      }
    }

    if (ticket.currentSession && !seen.has(ticket.currentSession.id)) {
      entries.push({
        phase: ticket.currentPhase,
        session: ticket.currentSession,
      });
    }

    return entries;
  }, [ticket.phaseHistory, ticket.currentSession, ticket.currentPhase]);

  const results = useQueries({
    queries: sessionEntries.map((entry) => ({
      queryKey: sessionLogKey(planId, ticketId, entry.session.id),
      queryFn: async () => {
        const path = resolveSessionLogPath(
          stateDir,
          planId,
          ticketId,
          entry.session.id,
        );
        try {
          const content = await readFile(path, "utf-8");
          return parseNormalizedSessionJsonl(content);
        } catch {
          return [] as LogEvent[];
        }
      },
    })),
  });

  useEffect(() => {
    if (sessionEntries.length === 0) return;

    const paths = sessionEntries.map((e) =>
      resolveSessionLogPath(stateDir, planId, ticketId, e.session.id),
    );

    const watcher = watch(paths, { ignoreInitial: true });

    const invalidate = (filePath: string) => {
      const idx = paths.indexOf(filePath);
      if (idx !== -1) {
        void queryClient.invalidateQueries({
          queryKey: sessionLogKey(
            planId,
            ticketId,
            sessionEntries[idx].session.id,
          ),
        });
      }
    };

    watcher.on("add", invalidate);
    watcher.on("change", invalidate);
    watcher.on("unlink", invalidate);

    return () => {
      watcher.close();
    };
  }, [sessionEntries, planId, ticketId, stateDir, queryClient]);

  return useMemo(() => {
    const allEvents: LogEvent[] = [];
    for (let i = 0; i < sessionEntries.length; i++) {
      const entry = sessionEntries[i];
      allEvents.push({
        type: "phase-divider",
        phase: entry.phase,
        session: entry.session,
      });
      const events = results[i]?.data ?? [];
      allEvents.push(...events);
    }
    return allEvents;
  }, [sessionEntries, results]);
}
