import { readFile } from "node:fs/promises";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { watch } from "chokidar";
import { useEffect, useMemo } from "react";
import type { PhaseHistoryEntry, TicketState } from "../../core/types.js";
import {
  type LogEvent,
  parseSessionJsonl,
  resolveSessionPath,
} from "../screens/TicketLogsScreen.helpers.js";

type PhaseWithSession = PhaseHistoryEntry & {
  session: { id: string; provider: "claude" };
};

function sessionLogKey(worktree: string, sessionId: string) {
  return ["session-log", worktree, sessionId] as const;
}

export function useSessionLogs(ticket: TicketState): LogEvent[] {
  const queryClient = useQueryClient();
  const worktree = ticket.worktree;

  const phasesWithSession = useMemo(
    () =>
      ticket.phaseHistory.filter(
        (e): e is PhaseWithSession => e.session?.provider === "claude",
      ),
    [ticket.phaseHistory],
  );

  const results = useQueries({
    queries: phasesWithSession.map((entry) => ({
      queryKey: sessionLogKey(worktree, entry.session.id),
      queryFn: async () => {
        const path = resolveSessionPath(worktree, entry.session.id);
        try {
          const content = await readFile(path, "utf-8");
          return parseSessionJsonl(content);
        } catch {
          return [] as LogEvent[];
        }
      },
    })),
  });

  useEffect(() => {
    if (phasesWithSession.length === 0) return;

    const paths = phasesWithSession.map((e) =>
      resolveSessionPath(worktree, e.session.id),
    );

    const watcher = watch(paths, { ignoreInitial: true });

    const invalidate = (filePath: string) => {
      const idx = paths.indexOf(filePath);
      if (idx !== -1) {
        void queryClient.invalidateQueries({
          queryKey: sessionLogKey(worktree, phasesWithSession[idx].session.id),
        });
      }
    };

    watcher.on("add", invalidate);
    watcher.on("change", invalidate);

    return () => {
      watcher.close();
    };
  }, [phasesWithSession, worktree, queryClient]);

  return useMemo(() => {
    const allEvents: LogEvent[] = [];
    for (let i = 0; i < phasesWithSession.length; i++) {
      const entry = phasesWithSession[i];
      allEvents.push({
        type: "phase-divider",
        phase: entry.phase,
        sessionId: entry.session.id,
      });
      const events = results[i]?.data ?? [];
      allEvents.push(...events);
    }
    return allEvents;
  }, [phasesWithSession, results]);
}
