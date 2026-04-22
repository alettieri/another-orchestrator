import { readFile } from "node:fs/promises";
import { watch } from "chokidar";
import { useEffect, useMemo, useState } from "react";
import type { PhaseHistoryEntry, TicketState } from "../../core/types.js";
import {
  type LogEvent,
  parseSessionJsonl,
  resolveSessionPath,
} from "../screens/TicketLogsScreen.helpers.js";

type PhaseWithSession = PhaseHistoryEntry & { sessionId: string };

export function useSessionLogs(ticket: TicketState): LogEvent[] {
  const [sessionEvents, setSessionEvents] = useState<Map<string, LogEvent[]>>(
    new Map(),
  );

  const phaseHistory = ticket.phaseHistory;
  const worktree = ticket.worktree;

  useEffect(() => {
    const phasesWithSession = phaseHistory.filter(
      (e): e is PhaseWithSession => e.sessionId != null,
    );

    const paths = phasesWithSession.map((e) =>
      resolveSessionPath(worktree, e.sessionId),
    );

    let cancelled = false;

    async function loadAll() {
      const results = await Promise.all(
        paths.map(async (path, idx) => {
          const entry = phasesWithSession[idx];
          try {
            const content = await readFile(path, "utf-8");
            return {
              sessionId: entry.sessionId,
              events: parseSessionJsonl(content),
            };
          } catch {
            return { sessionId: entry.sessionId, events: [] as LogEvent[] };
          }
        }),
      );

      if (cancelled) return;

      setSessionEvents(new Map(results.map((r) => [r.sessionId, r.events])));
    }

    loadAll();

    if (paths.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const watcher = watch(paths, { ignoreInitial: true });

    const handleFile = async (filePath: string) => {
      const idx = paths.indexOf(filePath);
      if (idx === -1) return;
      const entry = phasesWithSession[idx];
      try {
        const content = await readFile(filePath, "utf-8");
        const events = parseSessionJsonl(content);
        if (!cancelled) {
          setSessionEvents((prev) => {
            const next = new Map(prev);
            next.set(entry.sessionId, events);
            return next;
          });
        }
      } catch {
        // file removed or unreadable — skip
      }
    };

    watcher.on("add", handleFile);
    watcher.on("change", handleFile);

    return () => {
      cancelled = true;
      watcher.close();
    };
  }, [phaseHistory, worktree]);

  return useMemo(() => {
    const phasesWithSession = phaseHistory.filter(
      (e): e is PhaseWithSession => e.sessionId != null,
    );

    const allEvents: LogEvent[] = [];
    for (const entry of phasesWithSession) {
      allEvents.push({
        type: "phase-divider",
        phase: entry.phase,
        sessionId: entry.sessionId,
      });
      const events = sessionEvents.get(entry.sessionId) ?? [];
      allEvents.push(...events);
    }

    return allEvents;
  }, [phaseHistory, sessionEvents]);
}
