import { useQueryClient } from "@tanstack/react-query";
import { watch } from "chokidar";
import { useEffect } from "react";
import { PLANS_KEY } from "./usePlans.js";
import { TICKETS_KEY } from "./useTicketsByPlan.js";

export function useStateWatcher(stateDir: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const debounceMs = 150;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const watcher = watch(stateDir, {
      ignoreInitial: true,
      depth: 3,
    });

    watcher.on("all", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: PLANS_KEY });
        queryClient.invalidateQueries({ queryKey: TICKETS_KEY });
      }, debounceMs);
    });

    return () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    };
  }, [stateDir, queryClient]);
}
