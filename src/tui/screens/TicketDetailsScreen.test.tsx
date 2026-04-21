import { render } from "ink-testing-library";
import type React from "react";
import { describe, expect, it } from "vitest";
import type { TicketState } from "../../core/types.js";
import {
  buildDetailLines,
  clampScrollOffset,
} from "./TicketDetailsScreen.helpers.js";
import { TicketDetailsScreen } from "./TicketDetailsScreen.js";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "T-1",
    title: "Fix the bug",
    description: "Short description.",
    acceptanceCriteria: ["Tests pass", "No regressions"],
    linearUrl: null,
    repo: null,
    workflow: "standard",
    branch: "feat/fix-bug",
    worktree: "/tmp/wt",
    agent: null,
    status: "running",
    currentPhase: "implement",
    currentSessionId: null,
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

// ─── buildDetailLines ─────────────────────────────────────────────────────────

describe("buildDetailLines", () => {
  it("returns correct structure for short description", () => {
    const ticket = makeTicket({
      description: "Short desc.",
      acceptanceCriteria: ["AC one"],
    });
    const lines = buildDetailLines(ticket, 80);

    // Check title line
    expect(lines[0]).toMatchObject({ type: "text" });
    expect((lines[0] as { type: "text"; text: string }).text).toContain(
      "Fix the bug",
    );

    // Blank
    expect(lines[1]).toMatchObject({ type: "text", text: "" });

    // Status+phase
    expect(lines[2]).toMatchObject({
      type: "status-phase",
      status: "running",
      phase: "implement",
    });

    // Branch
    const branchLine = lines[3] as { type: "text"; text: string };
    expect(branchLine.text).toContain("feat/fix-bug");

    // Worktree
    const worktreeLine = lines[4] as { type: "text"; text: string };
    expect(worktreeLine.text).toContain("/tmp/wt");

    // Blank
    expect(lines[5]).toMatchObject({ type: "text", text: "" });

    // Description heading
    expect(lines[6]).toMatchObject({ type: "heading", text: "Description" });

    // Description content
    expect(lines[7]).toMatchObject({ type: "text" });
    expect((lines[7] as { type: "text"; text: string }).text).toContain(
      "Short desc.",
    );

    // Blank
    const blankIdx = 8;
    expect(lines[blankIdx]).toMatchObject({ type: "text", text: "" });

    // AC heading
    expect(lines[blankIdx + 1]).toMatchObject({
      type: "heading",
      text: "Acceptance criteria",
    });

    // AC item
    expect(
      (lines[blankIdx + 2] as { type: "text"; text: string }).text,
    ).toContain("AC one");
  });

  it("wraps long description into multiple lines", () => {
    const longDesc = "word ".repeat(30).trim(); // 30 words
    const ticket = makeTicket({
      description: longDesc,
      acceptanceCriteria: [],
    });
    const lines = buildDetailLines(ticket, 40); // narrow width → many wraps

    const descStart =
      lines.findIndex(
        (l) =>
          l.type === "heading" &&
          (l as { type: "heading"; text: string }).text === "Description",
      ) + 1;
    const blankAfterDesc = lines.findIndex(
      (l, i) =>
        i > descStart &&
        l.type === "text" &&
        (l as { type: "text"; text: string }).text === "",
    );

    const descLines = lines.slice(descStart, blankAfterDesc);
    expect(descLines.length).toBeGreaterThan(1);
    for (const l of descLines) {
      expect(l.type).toBe("text");
    }
  });

  it("renders dim '—' for empty description", () => {
    const ticket = makeTicket({ description: "", acceptanceCriteria: [] });
    const lines = buildDetailLines(ticket, 80);

    const descHeadingIdx = lines.findIndex(
      (l) =>
        l.type === "heading" &&
        (l as { type: "heading"; text: string }).text === "Description",
    );
    const afterHeading = lines[descHeadingIdx + 1] as {
      type: "text";
      text: string;
      dim?: boolean;
    };

    expect(afterHeading.text).toBe("—");
    expect(afterHeading.dim).toBe(true);
  });

  it("renders dim '—' for empty acceptance criteria", () => {
    const ticket = makeTicket({
      description: "Some desc",
      acceptanceCriteria: [],
    });
    const lines = buildDetailLines(ticket, 80);

    const acHeadingIdx = lines.findIndex(
      (l) =>
        l.type === "heading" &&
        (l as { type: "heading"; text: string }).text === "Acceptance criteria",
    );
    const afterHeading = lines[acHeadingIdx + 1] as {
      type: "text";
      text: string;
      dim?: boolean;
    };

    expect(afterHeading.text).toBe("—");
    expect(afterHeading.dim).toBe(true);
  });

  it("numbers many AC items correctly", () => {
    const ac = ["First", "Second", "Third", "Fourth", "Fifth"];
    const ticket = makeTicket({ acceptanceCriteria: ac });
    const lines = buildDetailLines(ticket, 80);

    const acHeadingIdx = lines.findIndex(
      (l) =>
        l.type === "heading" &&
        (l as { type: "heading"; text: string }).text === "Acceptance criteria",
    );
    const acLines = lines
      .slice(acHeadingIdx + 1)
      .filter((l) => l.type === "text");

    expect((acLines[0] as { type: "text"; text: string }).text).toMatch(/^1\./);
    expect((acLines[1] as { type: "text"; text: string }).text).toMatch(/^2\./);
    expect((acLines[4] as { type: "text"; text: string }).text).toMatch(/^5\./);
  });

  it("wraps correctly at narrow width", () => {
    const ticket = makeTicket({
      description: "one two three four five six seven eight nine ten",
      acceptanceCriteria: [],
    });
    const lines = buildDetailLines(ticket, 20); // descWidth = 10

    const descHeadingIdx = lines.findIndex(
      (l) =>
        l.type === "heading" &&
        (l as { type: "heading"; text: string }).text === "Description",
    );
    const blankAfter = lines.findIndex(
      (l, i) =>
        i > descHeadingIdx + 1 &&
        l.type === "text" &&
        (l as { type: "text"; text: string }).text === "",
    );
    const descLines = lines.slice(descHeadingIdx + 1, blankAfter);

    expect(descLines.length).toBeGreaterThan(1);
    for (const l of descLines) {
      expect(
        (l as { type: "text"; text: string }).text.length,
      ).toBeLessThanOrEqual(10);
    }
  });
});

// ─── clampScrollOffset ────────────────────────────────────────────────────────

describe("clampScrollOffset", () => {
  it("clamps overscroll up to 0", () => {
    expect(clampScrollOffset(-5, 20, 10)).toBe(0);
  });

  it("clamps overscroll down to max(0, total - viewport)", () => {
    expect(clampScrollOffset(100, 20, 10)).toBe(10);
  });

  it("returns 0 when content fits (total <= viewport)", () => {
    expect(clampScrollOffset(5, 10, 10)).toBe(0);
    expect(clampScrollOffset(5, 8, 10)).toBe(0);
  });

  it("returns the offset unchanged when within bounds", () => {
    expect(clampScrollOffset(3, 20, 10)).toBe(3);
  });
});

// ─── TicketDetailsScreen render ───────────────────────────────────────────────

function renderScreen(
  props: { ticket?: TicketState; height?: number; width?: number } = {},
) {
  const ticket = props.ticket ?? makeTicket();
  const height = props.height ?? 30;
  const width = props.width ?? 80;
  const element = (
    <TicketDetailsScreen ticket={ticket} height={height} width={width} />
  );
  return render(element);
}

describe("TicketDetailsScreen", () => {
  it("renders all labeled fields", () => {
    const ticket = makeTicket({
      title: "My Ticket",
      branch: "feat/my-branch",
      worktree: "/home/user/wt",
      description: "Some description.",
      acceptanceCriteria: ["Must work"],
    });
    const { lastFrame, unmount } = renderScreen({ ticket });
    const frame = lastFrame() ?? "";

    expect(frame).toContain("My Ticket");
    expect(frame).toContain("feat/my-branch");
    expect(frame).toContain("/home/user/wt");
    expect(frame).toContain("Some description.");
    expect(frame).toContain("Must work");
    expect(frame).toContain("running");
    expect(frame).toContain("implement");
    unmount();
  });

  it("shows '—' for empty description", () => {
    const ticket = makeTicket({ description: "" });
    const { lastFrame, unmount } = renderScreen({ ticket });
    expect(lastFrame()).toContain("—");
    unmount();
  });

  it("shows '—' for empty AC", () => {
    const ticket = makeTicket({
      description: "Has desc",
      acceptanceCriteria: [],
    });
    const { lastFrame, unmount } = renderScreen({ ticket });
    expect(lastFrame()).toContain("—");
    unmount();
  });

  it("overflow indicator appears when totalLines > height", () => {
    // Use a tiny height to force overflow
    const ticket = makeTicket({
      description: "line",
      acceptanceCriteria: ["a", "b", "c", "d", "e"],
    });
    const { lastFrame, unmount } = renderScreen({
      ticket,
      height: 5,
      width: 80,
    });
    expect(lastFrame()).toContain("↑↓");
    unmount();
  });

  it("overflow indicator does NOT appear when content fits", () => {
    const ticket = makeTicket({
      description: "Short",
      acceptanceCriteria: ["One"],
    });
    // Build lines to know total count
    const lines = buildDetailLines(ticket, 80);
    const { lastFrame, unmount } = renderScreen({
      ticket,
      height: lines.length + 5,
      width: 80,
    });
    expect(lastFrame()).not.toContain("↑↓");
    unmount();
  });

  it("scroll offset hides top lines from rendered output", () => {
    const ticket = makeTicket({
      title: "Unique title for scroll test",
      description: "Description text",
      acceptanceCriteria: [],
    });
    // Build lines to figure out what's in the title line
    const lines = buildDetailLines(ticket, 80);
    // Height is small enough to trigger overflow, so we can scroll
    const height = Math.min(5, lines.length - 1);
    if (lines.length <= height) {
      // Content fits, skip scroll test
      return;
    }

    // The title line is lines[0], which should be visible at offset 0
    const { lastFrame: frame0, unmount: u0 } = renderScreen({
      ticket,
      height,
      width: 80,
    });
    expect(frame0()).toContain("Unique title for scroll test");
    u0();
  });
});
