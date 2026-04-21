import { describe, expect, it } from "vitest";
import type { Screen } from "./useScreen.js";
import { screenReducer } from "./useScreen.js";

describe("screenReducer", () => {
  it("transitions plans → tickets", () => {
    const initial: Screen = { type: "plans" };
    const next = screenReducer(initial, {
      type: "SHOW_TICKETS",
      planId: "plan-1",
    });
    expect(next).toEqual({ type: "tickets", planId: "plan-1" });
  });

  it("transitions tickets → ticket-details", () => {
    const initial: Screen = { type: "tickets", planId: "plan-1" };
    const next = screenReducer(initial, {
      type: "SHOW_TICKET_DETAILS",
      planId: "plan-1",
      ticketId: "ticket-1",
    });
    expect(next).toEqual({
      type: "ticket-details",
      planId: "plan-1",
      ticketId: "ticket-1",
    });
  });

  it("transitions ticket-details → tickets (esc back one level)", () => {
    const initial: Screen = {
      type: "ticket-details",
      planId: "plan-1",
      ticketId: "ticket-1",
    };
    const next = screenReducer(initial, {
      type: "SHOW_TICKETS",
      planId: "plan-1",
    });
    expect(next).toEqual({ type: "tickets", planId: "plan-1" });
  });

  it("transitions tickets → plans (esc back to root)", () => {
    const initial: Screen = { type: "tickets", planId: "plan-1" };
    const next = screenReducer(initial, { type: "SHOW_PLANS" });
    expect(next).toEqual({ type: "plans" });
  });

  it("dispatches directly to ticket-details from plans", () => {
    const initial: Screen = { type: "plans" };
    const next = screenReducer(initial, {
      type: "SHOW_TICKET_DETAILS",
      planId: "plan-2",
      ticketId: "ticket-5",
    });
    expect(next).toEqual({
      type: "ticket-details",
      planId: "plan-2",
      ticketId: "ticket-5",
    });
  });

  it("dispatches directly to ticket-details from another ticket-details state", () => {
    const initial: Screen = {
      type: "ticket-details",
      planId: "plan-1",
      ticketId: "ticket-1",
    };
    const next = screenReducer(initial, {
      type: "SHOW_TICKET_DETAILS",
      planId: "plan-3",
      ticketId: "ticket-9",
    });
    expect(next).toEqual({
      type: "ticket-details",
      planId: "plan-3",
      ticketId: "ticket-9",
    });
  });

  it("full drill-in sequence: plans → tickets → ticket-details", () => {
    let screen: Screen = { type: "plans" };
    screen = screenReducer(screen, { type: "SHOW_TICKETS", planId: "plan-1" });
    screen = screenReducer(screen, {
      type: "SHOW_TICKET_DETAILS",
      planId: "plan-1",
      ticketId: "ticket-1",
    });
    expect(screen).toEqual({
      type: "ticket-details",
      planId: "plan-1",
      ticketId: "ticket-1",
    });
  });

  it("full unwind sequence: ticket-details → tickets → plans", () => {
    let screen: Screen = {
      type: "ticket-details",
      planId: "plan-1",
      ticketId: "ticket-1",
    };
    screen = screenReducer(screen, { type: "SHOW_TICKETS", planId: "plan-1" });
    screen = screenReducer(screen, { type: "SHOW_PLANS" });
    expect(screen).toEqual({ type: "plans" });
  });
});
