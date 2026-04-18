import { watch } from "chokidar";
import { Box, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StateManager } from "../core/state.js";
import type { PlanFile, TicketState } from "../core/types.js";
import { Breadcrumb } from "./components/Breadcrumb.js";
import { Footer, type Hotkey } from "./components/Footer.js";
import { Header } from "./components/Header.js";
import { PlansScreen } from "./screens/PlansScreen.js";

interface AppProps {
  stateManager: StateManager;
  stateDir: string;
}

export function App({ stateManager, stateDir }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [plans, setPlans] = useState<PlanFile[]>([]);
  const [ticketsByPlan, setTicketsByPlan] = useState<
    Map<string, TicketState[]>
  >(new Map());

  const loadData = useCallback(async () => {
    const allPlans = await stateManager.listPlans();
    setPlans(allPlans);
    const ticketMap = new Map<string, TicketState[]>();
    for (const plan of allPlans) {
      const tickets = await stateManager.listTickets(plan.id);
      ticketMap.set(plan.id, tickets);
    }
    setTicketsByPlan(ticketMap);
  }, [stateManager]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Watch state dir for changes, debounced
  useEffect(() => {
    const debounceMs = 150;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const watcher = watch(stateDir, {
      ignoreInitial: true,
      depth: 2,
    });

    watcher.on("all", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        loadData();
      }, debounceMs);
    });

    return () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    };
  }, [stateDir, loadData]);

  // Global quit key
  useInput(
    useCallback(
      (input) => {
        if (input === "q") {
          exit();
        }
      },
      [exit],
    ),
  );

  const runningCount = useMemo(() => {
    let count = 0;
    for (const tickets of ticketsByPlan.values()) {
      count += tickets.filter((t) => t.status === "running").length;
    }
    return count;
  }, [ticketsByPlan]);

  const breadcrumbPath = ["Plans"];

  const hotkeys: Hotkey[] = [
    { key: "↑↓", label: "navigate" },
    { key: "⏎", label: "open" },
    { key: "/", label: "filter" },
    { key: "q", label: "quit" },
  ];

  // Reserve lines for header (1) + breadcrumb (1) + column header (1) + footer (1) + padding (2)
  const terminalHeight = stdout?.rows ?? 24;
  const tableHeight = Math.max(1, terminalHeight - 6);

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Header planCount={plans.length} runningCount={runningCount} />
      <Breadcrumb path={breadcrumbPath} />
      <Box flexDirection="column" flexGrow={1}>
        <PlansScreen
          plans={plans}
          ticketsByPlan={ticketsByPlan}
          onSelectPlan={() => {
            // Ticket screen navigation is out of scope for TUI-001
          }}
          height={tableHeight}
        />
      </Box>
      <Footer hotkeys={hotkeys} />
    </Box>
  );
}
