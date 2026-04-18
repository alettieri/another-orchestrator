import { useQuery, useQueryClient } from "@tanstack/react-query";
import { watch } from "chokidar";
import { useEffect } from "react";
import type { StateManager } from "../../core/state.js";
import type { PlanFile, TicketState } from "../../core/types.js";

const PLANS_KEY = ["plans"] as const;
const TICKETS_KEY = ["ticketsByPlan"] as const;

export function usePlans(stateManager: StateManager) {
  return useQuery<PlanFile[]>({
    queryKey: [...PLANS_KEY],
    queryFn: () => stateManager.listPlans(),
  });
}

export function useTicketsByPlan(
  stateManager: StateManager,
  plans: PlanFile[],
) {
  return useQuery<Map<string, TicketState[]>>({
    queryKey: [...TICKETS_KEY, plans.map((p) => p.id)],
    queryFn: async () => {
      const ticketMap = new Map<string, TicketState[]>();
      for (const plan of plans) {
        const tickets = await stateManager.listTickets(plan.id);
        ticketMap.set(plan.id, tickets);
      }
      return ticketMap;
    },
    enabled: plans.length > 0,
  });
}

export function useStateWatcher(stateDir: string) {
  const queryClient = useQueryClient();

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
        queryClient.invalidateQueries({ queryKey: [...PLANS_KEY] });
        queryClient.invalidateQueries({ queryKey: [...TICKETS_KEY] });
      }, debounceMs);
    });

    return () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    };
  }, [stateDir, queryClient]);
}
