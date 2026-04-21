import { useCallback, useReducer } from "react";

type Screen =
  | { type: "plans" }
  | { type: "tickets"; planId: string }
  | { type: "ticket-details"; planId: string; ticketId: string };

type ScreenAction =
  | { type: "SHOW_PLANS" }
  | { type: "SHOW_TICKETS"; planId: string }
  | { type: "SHOW_TICKET_DETAILS"; planId: string; ticketId: string };

export function screenReducer(_state: Screen, action: ScreenAction): Screen {
  switch (action.type) {
    case "SHOW_PLANS":
      return { type: "plans" };
    case "SHOW_TICKETS":
      return { type: "tickets", planId: action.planId };
    case "SHOW_TICKET_DETAILS":
      return {
        type: "ticket-details",
        planId: action.planId,
        ticketId: action.ticketId,
      };
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
  const showTicketDetailsScreen = useCallback(
    ({ planId, ticketId }: { planId: string; ticketId: string }) =>
      dispatch({ type: "SHOW_TICKET_DETAILS", planId, ticketId }),
    [],
  );

  return {
    currentScreen: screen,
    showPlansScreen,
    showTicketsScreen,
    showTicketDetailsScreen,
  };
}

export type { Screen, ScreenAction };
