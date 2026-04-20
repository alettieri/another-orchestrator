import { Box, Text } from "ink";
import type React from "react";
import { useMemo, useState } from "react";
import type { PlanFile, TicketState } from "../../core/types.js";
import { SessionCopyCell } from "../components/SessionCopyCell.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { type Column, Table } from "../components/Table.js";
import { PHASE_COLORS, PHASE_LABELS } from "../constants/phase.js";
import type { PhaseId } from "../types/phase.js";

interface TicketsScreenProps {
  plan: PlanFile;
  tickets: TicketState[];
  height?: number;
}

function formatAge(ticket: TicketState): string {
  // Use the latest phase history entry's startedAt, or fall back to first entry
  const history = ticket.phaseHistory;
  const currentEntry = [...history]
    .reverse()
    .find((entry) => entry.phase === ticket.currentPhase);
  const timestamp = currentEntry?.startedAt ?? history[0]?.startedAt;
  if (!timestamp) return "—";

  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (Number.isNaN(then)) return "—";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatPhase(ticket: TicketState): React.ReactElement {
  const { currentPhase } = ticket;
  if (!currentPhase) return <Text dimColor>—</Text>;

  const phaseId = currentPhase as PhaseId;
  const label = PHASE_LABELS[phaseId] ?? currentPhase;
  const color = PHASE_COLORS[phaseId];

  return <Text color={color}>{label}</Text>;
}

function getRetryCount(ticket: TicketState): number {
  return Object.values(ticket.retries).reduce<number>((sum, n) => sum + n, 0);
}

export function getLatestSessionId(ticket: TicketState): string | null {
  const entry = [...ticket.phaseHistory]
    .reverse()
    .find((e) => e.sessionId !== undefined);
  return entry?.sessionId ?? null;
}

function getBlockedBy(plan: PlanFile, ticketId: string): string {
  const entry = plan.tickets.find((t) => t.ticketId === ticketId);
  if (!entry || entry.blockedBy.length === 0) return "—";
  return entry.blockedBy.join(", ");
}

const COLUMNS: Column[] = [
  { key: "ticket", label: "TICKET", width: 24 },
  { key: "status", label: "STATUS", width: 18 },
  { key: "phase", label: "PHASE", width: 20 },
  { key: "retry", label: "RETRY", width: 8 },
  { key: "block", label: "BLOCK", width: 16 },
  { key: "age", label: "AGE", width: 8 },
  { key: "session", label: "SESSION", width: 14 },
];

export function TicketsScreen({
  plan,
  tickets,
  height,
}: TicketsScreenProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const rows = useMemo(() => {
    return tickets.map((ticket, index) => {
      const retryCount = getRetryCount(ticket);
      const blockedBy = getBlockedBy(plan, ticket.ticketId);
      const sessionId = getLatestSessionId(ticket);

      return {
        ticket: ticket.ticketId,
        status: <StatusBadge status={ticket.status} />,
        phase: formatPhase(ticket),
        retry: (
          <Text color={retryCount > 0 ? "yellow" : undefined}>
            {retryCount > 0 ? String(retryCount) : "—"}
          </Text>
        ),
        block: <Text dimColor={blockedBy === "—"}>{blockedBy}</Text>,
        age: formatAge(ticket),
        session: (
          <SessionCopyCell
            sessionId={sessionId}
            isSelected={index === selectedIndex}
          />
        ),
      };
    });
  }, [tickets, plan, selectedIndex]);

  if (tickets.length === 0) {
    return (
      <Box>
        <Text dimColor>No tickets found.</Text>
      </Box>
    );
  }

  return (
    <Table
      columns={COLUMNS}
      rows={rows}
      selectedIndex={selectedIndex}
      onSelect={setSelectedIndex}
      height={height}
    />
  );
}
