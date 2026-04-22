import { useQueries, useQueryClient } from "@tanstack/react-query";
import { watch } from "chokidar";
import { useEffect, useMemo } from "react";
import type { PhaseHistoryEntry, TicketState } from "../../core/types.js";
import {
  type LogEvent,
  readSessionEvents,
  resolveClaudeSessionPath,
  resolveCodexSessionsRoot,
  type SessionLogReference,
} from "../screens/TicketLogsScreen.helpers.js";

type PhaseWithSession = PhaseHistoryEntry & { sessionId: string };

function sessionLogKey(worktree: string, session: SessionLogReference) {
  return [
    "session-log",
    worktree,
    session.provider,
    session.sessionId,
  ] as const;
}

export function useSessionLogs(ticket: TicketState): LogEvent[] {
  const queryClient = useQueryClient();
  const worktree = ticket.worktree;

  const phasesWithSession = useMemo(
    () =>
      ticket.phaseHistory.filter(
        (e): e is PhaseWithSession => e.sessionId != null,
      ),
    [ticket.phaseHistory],
  );
  const sessions = useMemo(
    () =>
      phasesWithSession.map((entry) => ({
        phase: entry.phase,
        session: {
          provider: entry.session?.provider ?? "claude",
          sessionId: entry.sessionId,
        },
      })),
    [phasesWithSession],
  );
  const claudeSessions = useMemo(
    () => sessions.filter(({ session }) => session.provider !== "codex"),
    [sessions],
  );

  const results = useQueries({
    queries: sessions.map(({ session }) => ({
      queryKey: sessionLogKey(worktree, session),
      queryFn: () => readSessionEvents(worktree, session),
    })),
  });

  useEffect(() => {
    if (sessions.length === 0) return;

    const claudePaths = claudeSessions.map(({ session }) =>
      resolveClaudeSessionPath(worktree, session.sessionId),
    );
    const hasCodexSession = sessions.some(
      ({ session }) => session.provider === "codex",
    );
    const watchTargets = hasCodexSession
      ? [...claudePaths, resolveCodexSessionsRoot()]
      : claudePaths;

    const watcher = watch(watchTargets, { ignoreInitial: true });

    const invalidate = (filePath: string) => {
      const claudeIdx = claudePaths.indexOf(filePath);
      if (claudeIdx !== -1) {
        const session = claudeSessions[claudeIdx]?.session;
        if (!session) return;
        void queryClient.invalidateQueries({
          queryKey: sessionLogKey(worktree, session),
        });
        return;
      }

      if (hasCodexSession && filePath.startsWith(resolveCodexSessionsRoot())) {
        for (const { session } of sessions) {
          if (session.provider !== "codex") continue;
          void queryClient.invalidateQueries({
            queryKey: sessionLogKey(worktree, session),
          });
        }
      }
    };

    watcher.on("add", invalidate);
    watcher.on("change", invalidate);

    return () => {
      watcher.close();
    };
  }, [claudeSessions, queryClient, sessions, worktree]);

  return useMemo(() => {
    const allEvents: LogEvent[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const entry = sessions[i];
      allEvents.push({
        type: "phase-divider",
        phase: entry.phase,
        sessionId: entry.session.sessionId,
      });
      const events = results[i]?.data ?? [];
      allEvents.push(...events);
    }
    return allEvents;
  }, [sessions, results]);
}
