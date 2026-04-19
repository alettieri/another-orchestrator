import { useCallback, useReducer } from "react";

type Screen = { type: "plans" } | { type: "tickets"; planId: string };

type ScreenAction =
  | { type: "SHOW_PLANS" }
  | { type: "SHOW_TICKETS"; planId: string };

function screenReducer(_state: Screen, action: ScreenAction): Screen {
  switch (action.type) {
    case "SHOW_PLANS":
      return { type: "plans" };
    case "SHOW_TICKETS":
      return { type: "tickets", planId: action.planId };
  }
}

export function useScreen() {
  const [screen, dispatch] = useReducer(screenReducer, { type: "plans" });

  const showPlansScreen = useCallback(
    () => dispatch({ type: "SHOW_PLANS" }),
    [],
  );
  const showTicketsScreen = useCallback(
    ({ planId }: { planId: string }) =>
      dispatch({ type: "SHOW_TICKETS", planId }),
    [],
  );

  return {
    currentScreen: screen,
    showPlansScreen,
    showTicketsScreen,
  };
}

export type { Screen };
