import { useQuery } from "@tanstack/react-query";
import type { StateManager } from "../../core/state.js";

export const PLANS_KEY = ["plans"] as const;

export function usePlans(stateManager: StateManager) {
  return useQuery({
    queryKey: PLANS_KEY,
    queryFn: () => stateManager.listPlans(),
  });
}
