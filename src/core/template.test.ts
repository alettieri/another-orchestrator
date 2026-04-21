import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTemplateRenderer } from "./template.js";
import type { TicketState } from "./types.js";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "TICKET-1",
    title: "Test Ticket",
    description: "A test ticket description",
    acceptanceCriteria: ["Tests pass", "Code reviewed"],
    linearUrl: "https://linear.app/test/TICKET-1",
    repo: "test-repo",
    workflow: "minimal",
    branch: "feat/ticket-1",
    worktree: "/tmp/worktrees/ticket-1",
    agent: "claude",
    status: "running",
    currentPhase: "run_script",
    currentSessionId: null,
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

describe("template", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "template-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("render", () => {
    it("renders a template file with ticket fields", async () => {
      await writeFile(
        join(tmpDir, "prompt.txt"),
        "Ticket: {{ ticketId }}\nTitle: {{ title }}",
      );
      const renderer = createTemplateRenderer(tmpDir);
      const result = renderer.render("prompt.txt", makeTicket());
      expect(result).toBe("Ticket: TICKET-1\nTitle: Test Ticket");
    });

    it("renders acceptance_criteria_list as markdown bullets", async () => {
      await writeFile(
        join(tmpDir, "criteria.txt"),
        "Criteria:\n{{ acceptance_criteria_list }}",
      );
      const renderer = createTemplateRenderer(tmpDir);
      const result = renderer.render("criteria.txt", makeTicket());
      expect(result).toBe("Criteria:\n- Tests pass\n- Code reviewed");
    });

    it("renders context values as top-level variables", async () => {
      await writeFile(join(tmpDir, "ctx.txt"), "PR: {{ pr_url }}");
      const renderer = createTemplateRenderer(tmpDir);
      const ticket = makeTicket({
        context: { pr_url: "https://github.com/pr/1" },
      });
      const result = renderer.render("ctx.txt", ticket);
      expect(result).toBe("PR: https://github.com/pr/1");
    });

    it("renders missing variables as empty strings", async () => {
      await writeFile(join(tmpDir, "missing.txt"), "Val: [{{ nonexistent }}]");
      const renderer = createTemplateRenderer(tmpDir);
      const result = renderer.render("missing.txt", makeTicket());
      expect(result).toBe("Val: []");
    });

    it("renders null linearUrl as empty string", async () => {
      await writeFile(join(tmpDir, "url.txt"), "URL: [{{ linearUrl }}]");
      const renderer = createTemplateRenderer(tmpDir);
      const ticket = makeTicket({ linearUrl: null });
      const result = renderer.render("url.txt", ticket);
      expect(result).toBe("URL: []");
    });
  });

  describe("renderString", () => {
    it("renders an inline template string", () => {
      const renderer = createTemplateRenderer(tmpDir);
      const result = renderer.renderString(
        "{{ branch }} in {{ repo }}",
        makeTicket(),
      );
      expect(result).toBe("feat/ticket-1 in test-repo");
    });

    it("renders context values in inline strings", () => {
      const renderer = createTemplateRenderer(tmpDir);
      const ticket = makeTicket({ context: { custom_val: "42" } });
      const result = renderer.renderString("val={{ custom_val }}", ticket);
      expect(result).toBe("val=42");
    });
  });
});
