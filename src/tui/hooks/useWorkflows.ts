import { useQuery } from "@tanstack/react-query";
import type { WorkflowDefinition } from "../../core/types.js";
import type { WorkflowLoader } from "../../core/workflow.js";

const WORKFLOWS_KEY = ["workflows"] as const;

export function useWorkflows(
  workflowLoader: WorkflowLoader | undefined,
  workflowNames: string[],
) {
  const uniqueNames = [...new Set(workflowNames)].sort();

  return useQuery<Map<string, WorkflowDefinition>>({
    queryKey: [...WORKFLOWS_KEY, uniqueNames],
    queryFn: async () => {
      const map = new Map<string, WorkflowDefinition>();
      if (!workflowLoader) return map;
      for (const name of uniqueNames) {
        try {
          const wf = await workflowLoader.loadWorkflow(name);
          map.set(name, wf);
        } catch {
          // Workflow not found — ignore
        }
      }
      return map;
    },
    enabled: uniqueNames.length > 0 && !!workflowLoader,
  });
}
