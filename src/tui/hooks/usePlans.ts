import { useQuery } from "@tanstack/react-query";
import type { StateManager } from "../../core/state.js";
import type { PlanFile } from "../../core/types.js";

export const PLANS_KEY = ["plans"] as const;

export function usePlans(stateManager: StateManager) {
  return useQuery({
    queryKey: PLANS_KEY,
    queryFn: () => stateManager.listPlans(),
  });
}
