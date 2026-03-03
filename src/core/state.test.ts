import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStateManager } from "./state.js";
import type { PlanFile, TicketState } from "./types.js";

function makePlan(overrides: Partial<PlanFile> = {}): PlanFile {
  return {
    id: "plan-1",
    name: "Test Plan",
    createdAt: "2025-01-01T00:00:00Z",
    createdBy: "user",
    repo: "test-repo",
    workflow: "default",
    agent: null,
    worktreeRoot: "/tmp/worktrees",
    status: "active",
    tickets: [
      { ticketId: "t-1", order: 1, blockedBy: [] },
      { ticketId: "t-2", order: 2, blockedBy: ["t-1"] },
    ],
    ...overrides,
  };
}

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "t-1",
    title: "Test Ticket",
    description: "Do the thing",
    acceptanceCriteria: [],
    linearUrl: null,
    repo: "test-repo",
    workflow: "default",
    branch: "feature/t-1",
    worktree: "/tmp/worktrees/t-1",
    agent: null,
    status: "queued",
    currentPhase: "init",
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

describe("StateManager", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = join(
      tmpdir(),
      `state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(stateDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  describe("plan operations", () => {
    it("saves and retrieves a plan", async () => {
      const sm = createStateManager(stateDir);
      const plan = makePlan();
      await sm.savePlan(plan);

      const retrieved = await sm.getPlan("plan-1");
      expect(retrieved).toEqual(plan);
    });

    it("returns null for missing plan", async () => {
      const sm = createStateManager(stateDir);
      expect(await sm.getPlan("nonexistent")).toBeNull();
    });

    it("lists all plans", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan({ id: "plan-1", name: "Plan A" }));
      await sm.savePlan(makePlan({ id: "plan-2", name: "Plan B" }));

      const plans = await sm.listPlans();
      expect(plans).toHaveLength(2);
      const ids = plans.map((p) => p.id).sort();
      expect(ids).toEqual(["plan-1", "plan-2"]);
    });

    it("returns empty array when no plans", async () => {
      const sm = createStateManager(stateDir);
      expect(await sm.listPlans()).toEqual([]);
    });
  });

  describe("ticket operations", () => {
    it("saves and retrieves a ticket", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      const ticket = makeTicket();
      await sm.saveTicket(ticket);

      const retrieved = await sm.getTicket("plan-1", "t-1");
      expect(retrieved).toEqual(ticket);
    });

    it("returns null for missing ticket", async () => {
      const sm = createStateManager(stateDir);
      expect(await sm.getTicket("plan-1", "nonexistent")).toBeNull();
    });

    it("lists tickets for a plan", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket({ ticketId: "t-1" }));
      await sm.saveTicket(makeTicket({ ticketId: "t-2" }));

      const tickets = await sm.listTickets("plan-1");
      expect(tickets).toHaveLength(2);
    });

    it("returns empty array when no tickets", async () => {
      const sm = createStateManager(stateDir);
      expect(await sm.listTickets("plan-1")).toEqual([]);
    });

    it("updates a ticket", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket());

      const updated = await sm.updateTicket("plan-1", "t-1", {
        status: "running",
        currentPhase: "build",
      });

      expect(updated.status).toBe("running");
      expect(updated.currentPhase).toBe("build");
    });

    it("throws when updating nonexistent ticket", async () => {
      const sm = createStateManager(stateDir);
      await expect(
        sm.updateTicket("plan-1", "nonexistent", { status: "running" }),
      ).rejects.toThrow('Ticket "nonexistent" not found');
    });
  });

  describe("scheduling", () => {
    it("getReadyTickets returns ready tickets with resolved deps", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket({ ticketId: "t-1", status: "complete" }));
      await sm.saveTicket(makeTicket({ ticketId: "t-2", status: "ready" }));

      const ready = await sm.getReadyTickets();
      expect(ready).toHaveLength(1);
      expect(ready[0].ticketId).toBe("t-2");
    });

    it("getReadyTickets excludes tickets with unresolved deps", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket({ ticketId: "t-1", status: "queued" }));
      await sm.saveTicket(makeTicket({ ticketId: "t-2", status: "ready" }));

      const ready = await sm.getReadyTickets();
      expect(ready).toHaveLength(0);
    });

    it("getRunningCount counts running tickets", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket({ ticketId: "t-1", status: "running" }));
      await sm.saveTicket(makeTicket({ ticketId: "t-2", status: "queued" }));

      expect(await sm.getRunningCount()).toBe(1);
    });

    it("getRunningCount returns 0 with no running tickets", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket({ ticketId: "t-1", status: "queued" }));

      expect(await sm.getRunningCount()).toBe(0);
    });
  });

  describe("resolveDependencies", () => {
    it("promotes queued tickets when deps are met", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket({ ticketId: "t-1", status: "complete" }));
      await sm.saveTicket(makeTicket({ ticketId: "t-2", status: "queued" }));

      await sm.resolveDependencies("plan-1");

      const ticket = await sm.getTicket("plan-1", "t-2");
      expect(ticket?.status).toBe("ready");
    });

    it("does not promote tickets with unresolved deps", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket({ ticketId: "t-1", status: "running" }));
      await sm.saveTicket(makeTicket({ ticketId: "t-2", status: "queued" }));

      await sm.resolveDependencies("plan-1");

      const ticket = await sm.getTicket("plan-1", "t-2");
      expect(ticket?.status).toBe("queued");
    });

    it("throws for nonexistent plan", async () => {
      const sm = createStateManager(stateDir);
      await expect(sm.resolveDependencies("nope")).rejects.toThrow(
        'Plan "nope" not found',
      );
    });
  });

  describe("multi-repo plans", () => {
    it("saves and retrieves a plan with null repo", async () => {
      const sm = createStateManager(stateDir);
      const plan = makePlan({ repo: null });
      await sm.savePlan(plan);

      const retrieved = await sm.getPlan("plan-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.repo).toBeNull();
    });

    it("handles tickets with different repos in the same plan", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan({ repo: null }));
      await sm.saveTicket(
        makeTicket({ ticketId: "t-1", repo: "/repos/backend" }),
      );
      await sm.saveTicket(
        makeTicket({ ticketId: "t-2", repo: "/repos/frontend" }),
      );

      const tickets = await sm.listTickets("plan-1");
      expect(tickets).toHaveLength(2);

      const repos = tickets.map((t) => t.repo).sort();
      expect(repos).toEqual(["/repos/backend", "/repos/frontend"]);
    });

    it("resolves cross-repo dependencies within a plan", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan({ repo: null }));
      await sm.saveTicket(
        makeTicket({
          ticketId: "t-1",
          repo: "/repos/backend",
          status: "complete",
        }),
      );
      await sm.saveTicket(
        makeTicket({
          ticketId: "t-2",
          repo: "/repos/frontend",
          status: "queued",
        }),
      );

      await sm.resolveDependencies("plan-1");

      const ticket = await sm.getTicket("plan-1", "t-2");
      expect(ticket?.status).toBe("ready");
    });

    it("getReadyTickets works with cross-repo tickets", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan({ repo: null }));
      await sm.saveTicket(
        makeTicket({
          ticketId: "t-1",
          repo: "/repos/backend",
          status: "complete",
        }),
      );
      await sm.saveTicket(
        makeTicket({
          ticketId: "t-2",
          repo: "/repos/frontend",
          status: "ready",
        }),
      );

      const ready = await sm.getReadyTickets();
      expect(ready).toHaveLength(1);
      expect(ready[0].ticketId).toBe("t-2");
      expect(ready[0].repo).toBe("/repos/frontend");
    });
  });

  describe("corrupted files", () => {
    it("returns null for corrupted plan file", async () => {
      const sm = createStateManager(stateDir);
      const planPath = join(stateDir, "plans", "bad", "plan.json");
      await mkdir(join(stateDir, "plans", "bad"), { recursive: true });
      await writeFile(planPath, "not json{{{");

      expect(await sm.getPlan("bad")).toBeNull();
    });

    it("skips corrupted ticket files in listing", async () => {
      const sm = createStateManager(stateDir);
      await sm.savePlan(makePlan());
      await sm.saveTicket(makeTicket({ ticketId: "t-1" }));

      const badPath = join(stateDir, "plans", "plan-1", "tickets", "bad.json");
      await writeFile(badPath, "corrupt");

      const tickets = await sm.listTickets("plan-1");
      expect(tickets).toHaveLength(1);
      expect(tickets[0].ticketId).toBe("t-1");
    });
  });
});
