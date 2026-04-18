import { Box, Text } from "ink";
import type React from "react";
import { useMemo, useState } from "react";
import type { PlanFile, TicketState } from "../../core/types.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { type Column, Table } from "../components/Table.js";

interface PlansScreenProps {
  plans: PlanFile[];
  ticketsByPlan: Map<string, TicketState[]>;
  onSelectPlan: (planId: string) => void;
  height?: number;
}

function formatAge(createdAt: string): string {
  const now = Date.now();
  const then = new Date(createdAt).getTime();
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

function buildProgressBar(
  completed: number,
  total: number,
): React.ReactElement {
  if (total === 0) return <Text dimColor>0/0 [░░░░░░░░]</Text>;
  const barWidth = 8;
  const filled = Math.round((completed / total) * barWidth);
  const empty = barWidth - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return (
    <Text>
      {completed}/{total} <Text dimColor>[</Text>
      <Text color="green">{bar.slice(0, filled)}</Text>
      <Text dimColor>{bar.slice(filled)}</Text>
      <Text dimColor>]</Text>
    </Text>
  );
}

const COLUMNS: Column[] = [
  { key: "name", label: "NAME", width: 30 },
  { key: "status", label: "STATUS", width: 12 },
  { key: "progress", label: "PROGRESS", width: 22 },
  { key: "running", label: "RUNNING", width: 10 },
  { key: "failed", label: "FAILED", width: 10 },
  { key: "age", label: "AGE", width: 8 },
];

export function PlansScreen({
  plans,
  ticketsByPlan,
  onSelectPlan,
  height,
}: PlansScreenProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const rows = useMemo(() => {
    return plans.map((plan) => {
      const tickets = ticketsByPlan.get(plan.id) ?? [];
      const completed = tickets.filter((t) => t.status === "complete").length;
      const running = tickets.filter((t) => t.status === "running").length;
      const failed = tickets.filter(
        (t) => t.status === "failed" || t.status === "needs_attention",
      ).length;

      return {
        name: plan.name,
        status: <StatusBadge status={plan.status} />,
        progress: buildProgressBar(completed, tickets.length),
        running: (
          <Text color={running > 0 ? "green" : undefined}>
            {running > 0 ? String(running) : "—"}
          </Text>
        ),
        failed: (
          <Text color={failed > 0 ? "red" : undefined}>
            {failed > 0 ? String(failed) : "—"}
          </Text>
        ),
        age: formatAge(plan.createdAt),
      };
    });
  }, [plans, ticketsByPlan]);

  if (plans.length === 0) {
    return (
      <Box>
        <Text dimColor>No plans found.</Text>
      </Box>
    );
  }

  return (
    <Table
      columns={COLUMNS}
      rows={rows}
      selectedIndex={selectedIndex}
      onSelect={setSelectedIndex}
      onActivate={(index) => {
        const plan = plans[index];
        if (plan) onSelectPlan(plan.id);
      }}
      height={height}
    />
  );
}
