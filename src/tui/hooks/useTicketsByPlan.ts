import { useQuery } from "@tanstack/react-query";
import type { StateManager } from "../../core/state.js";
import type { PlanFile, TicketState } from "../../core/types.js";

export const TICKETS_KEY = ["ticketsByPlan"] as const;

export function useTicketsByPlan(
  stateManager: StateManager,
  plans: PlanFile[],
) {
  return useQuery({
    queryKey: [...TICKETS_KEY, plans.map((p) => p.id)],
    queryFn: async () => {
      const entries = await Promise.all(
        plans.map(
          async (plan): Promise<[string, TicketState[]]> => [
            plan.id,
            await stateManager.listTickets(plan.id),
          ],
        ),
      );
      return new Map(entries);
    },
    enabled: plans.length > 0,
  });
}
