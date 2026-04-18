import { QueryClientProvider } from "@tanstack/react-query";
import { Box, useApp, useInput, useStdout } from "ink";
import { useCallback } from "react";
import type { StateManager } from "../core/state.js";
import type { TicketState } from "../core/types.js";
import { Breadcrumb } from "./components/Breadcrumb.js";
import { Footer, type Hotkey } from "./components/Footer.js";
import { Header } from "./components/Header.js";
import {
  usePlans,
  useStateWatcher,
  useTicketsByPlan,
} from "./hooks/useStateData.js";
import { queryClient } from "./queries/query-client.js";
import { PlansScreen } from "./screens/PlansScreen.js";

interface AppProps {
  stateManager: StateManager;
  stateDir: string;
}

const breadcrumbPath = ["Plans"];

const hotkeys: Hotkey[] = [
  { key: "↑↓", label: "navigate" },
  { key: "⏎", label: "open" },
  { key: "/", label: "filter" },
  { key: "q", label: "quit" },
];

function countRunning(ticketsByPlan: Map<string, TicketState[]>): number {
  return Array.from(ticketsByPlan.values()).reduce(
    (count, tickets) =>
      count + tickets.filter((t) => t.status === "running").length,
    0,
  );
}

export function App({ stateManager, stateDir }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner stateManager={stateManager} stateDir={stateDir} />
    </QueryClientProvider>
  );
}

function AppInner({ stateManager, stateDir }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const { data: plans = [] } = usePlans(stateManager);
  const { data: ticketsByPlan = new Map<string, TicketState[]>() } =
    useTicketsByPlan(stateManager, plans);

  useStateWatcher(stateDir);

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

  const runningCount = countRunning(ticketsByPlan);

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
