import { QueryClientProvider } from "@tanstack/react-query";
import { Box, useApp, useInput, useStdout } from "ink";
import { useCallback, useMemo } from "react";
import type { StateManager } from "../core/state.js";
import type { TicketState } from "../core/types.js";
import type { WorkflowLoader } from "../core/workflow.js";
import { Breadcrumb } from "./components/Breadcrumb.js";
import { Footer, type Hotkey } from "./components/Footer.js";
import { Header } from "./components/Header.js";
import { usePlans } from "./hooks/usePlans.js";
import { useScreen } from "./hooks/useScreen.js";
import { useStateWatcher } from "./hooks/useStateWatcher.js";
import { useTicketsByPlan } from "./hooks/useTicketsByPlan.js";
import { useWorkflows } from "./hooks/useWorkflows.js";
import { queryClient } from "./queries/query-client.js";
import { PlansScreen } from "./screens/PlansScreen.js";
import { TicketsScreen } from "./screens/TicketsScreen.js";

interface AppProps {
  stateManager: StateManager;
  stateDir: string;
  workflowLoader?: WorkflowLoader;
}

const PLANS_HOTKEYS: Hotkey[] = [
  { key: "↑↓", label: "navigate" },
  { key: "⏎", label: "open" },
  { key: "/", label: "filter" },
  { key: "p", label: "pause" },
  { key: "r", label: "resume" },
  { key: "q", label: "quit" },
];

const TICKETS_HOTKEYS: Hotkey[] = [
  { key: "↑↓", label: "navigate" },
  { key: "⏎", label: "open" },
  { key: "esc", label: "back" },
  { key: "/", label: "filter" },
  { key: "c", label: "copy resume cmd" },
  { key: "p", label: "pause" },
  { key: "r", label: "resume" },
  { key: "s", label: "skip" },
  { key: "q", label: "quit" },
];

function countRunning(ticketsByPlan: Map<string, TicketState[]>): number {
  return Array.from(ticketsByPlan.values()).reduce(
    (count, tickets) =>
      count + tickets.filter((t) => t.status === "running").length,
    0,
  );
}

export function App({ stateManager, stateDir, workflowLoader }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner
        stateManager={stateManager}
        stateDir={stateDir}
        workflowLoader={workflowLoader}
      />
    </QueryClientProvider>
  );
}

function AppInner({ stateManager, stateDir, workflowLoader }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const { currentScreen, showPlansScreen, showTicketsScreen } = useScreen();

  const { data: plans = [] } = usePlans(stateManager);
  const { data: ticketsByPlan = new Map<string, TicketState[]>() } =
    useTicketsByPlan(stateManager, plans);

  useStateWatcher(stateDir);

  const selectedPlan =
    currentScreen.type === "tickets"
      ? plans.find((p) => p.id === currentScreen.planId)
      : undefined;
  const selectedTickets =
    currentScreen.type === "tickets"
      ? (ticketsByPlan.get(currentScreen.planId) ?? [])
      : [];

  const { data: workflows = new Map() } = useWorkflows(
    workflowLoader,
    selectedTickets.map((t) => t.workflow),
  );

  // Global keys
  useInput(
    useCallback(
      (input, key) => {
        if (input === "q") {
          exit();
        }
        if (key.escape && currentScreen.type === "tickets") {
          showPlansScreen();
        }
      },
      [exit, currentScreen, showPlansScreen],
    ),
  );

  const runningCount = countRunning(ticketsByPlan);

  // Reserve lines for header (1) + breadcrumb (1) + column header (1) + footer (1) + padding (2)
  const terminalHeight = stdout?.rows ?? 24;
  const tableHeight = Math.max(1, terminalHeight - 6);

  const breadcrumbPath = useMemo(() => {
    if (currentScreen.type === "tickets" && selectedPlan) {
      return ["Plans", selectedPlan.name];
    }
    return ["Plans"];
  }, [currentScreen, selectedPlan]);

  const hotkeys =
    currentScreen.type === "tickets" ? TICKETS_HOTKEYS : PLANS_HOTKEYS;

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Header planCount={plans.length} runningCount={runningCount} />
      <Breadcrumb path={breadcrumbPath} />
      <Box flexDirection="column" flexGrow={1}>
        {currentScreen.type === "tickets" && selectedPlan ? (
          <TicketsScreen
            plan={selectedPlan}
            tickets={selectedTickets}
            workflows={workflows}
            stateManager={stateManager}
            height={tableHeight}
          />
        ) : (
          <PlansScreen
            plans={plans}
            ticketsByPlan={ticketsByPlan}
            stateManager={stateManager}
            onSelectPlan={(planId) => {
              showTicketsScreen({ planId });
            }}
            height={tableHeight}
          />
        )}
      </Box>
      <Footer hotkeys={hotkeys} />
    </Box>
  );
}
