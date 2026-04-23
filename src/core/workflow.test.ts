import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowLoader } from "./workflow.js";

describe("workflow", () => {
  let tmpDir: string;

  const minimalYaml = `
name: minimal
description: "Minimal test workflow"
tags: [test, minimal]
phases:
  - id: run_script
    type: script
    command: run.sh
    args:
      - "{{ branch }}"
    maxRetries: 2
    capture:
      script_output: stdout
    onSuccess: complete
    onFailure: abort
  - id: complete
    type: terminal
  - id: abort
    type: terminal
    notify: true
`;

  const fullYaml = `
name: full
description: "Full workflow"
tags: [production]
phases:
  - id: start
    type: script
    command: start.sh
    onSuccess: done
  - id: done
    type: terminal
`;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "workflow-test-"));
    await writeFile(join(tmpDir, "minimal.yaml"), minimalYaml);
    await writeFile(join(tmpDir, "full.yaml"), fullYaml);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadRegistry", () => {
    it("discovers workflows by scanning yaml files", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      const entries = await loader.loadRegistry();
      expect(entries).toHaveLength(2);
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(["full", "minimal"]);
    });

    it("includes description and tags from workflow files", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      const entries = await loader.loadRegistry();
      const minimal = entries.find((e) => e.name === "minimal");
      expect(minimal?.description).toBe("Minimal test workflow");
      expect(minimal?.tags).toEqual(["test", "minimal"]);
    });

    it("skips files without name or phases fields", async () => {
      await writeFile(join(tmpDir, "not-a-workflow.yaml"), "key: value\n");
      const loader = createWorkflowLoader([tmpDir]);
      const entries = await loader.loadRegistry();
      expect(entries).toHaveLength(2);
    });

    it("skips non-yaml files", async () => {
      await writeFile(join(tmpDir, "readme.md"), "# Hello");
      const loader = createWorkflowLoader([tmpDir]);
      const entries = await loader.loadRegistry();
      expect(entries).toHaveLength(2);
    });
  });

  describe("multi-directory search", () => {
    let userDir: string;

    beforeEach(async () => {
      userDir = await mkdtemp(join(tmpdir(), "workflow-user-"));
    });

    afterEach(async () => {
      await rm(userDir, { recursive: true, force: true });
    });

    it("user dir overrides bundled workflow with same name", async () => {
      const userMinimal = `
name: minimal
description: "User-customized minimal"
tags: [custom]
phases:
  - id: custom_step
    type: script
    command: custom.sh
    onSuccess: done
  - id: done
    type: terminal
`;
      await writeFile(join(userDir, "minimal.yaml"), userMinimal);
      // userDir first = higher priority
      const loader = createWorkflowLoader([userDir, tmpDir]);
      const workflow = await loader.loadWorkflow("minimal");
      expect(workflow.description).toBe("User-customized minimal");
      expect(workflow.phases[0].id).toBe("custom_step");
    });

    it("bundled workflows are available when user dir has no override", async () => {
      const loader = createWorkflowLoader([userDir, tmpDir]);
      const workflow = await loader.loadWorkflow("full");
      expect(workflow.description).toBe("Full workflow");
    });

    it("user dir can add new workflows", async () => {
      const customYaml = `
name: deploy
description: "Custom deploy workflow"
tags: [deploy]
phases:
  - id: deploy_step
    type: script
    command: deploy.sh
    onSuccess: done
  - id: done
    type: terminal
`;
      await writeFile(join(userDir, "deploy.yaml"), customYaml);
      const loader = createWorkflowLoader([userDir, tmpDir]);
      const entries = await loader.loadRegistry();
      expect(entries).toHaveLength(3);
      const workflow = await loader.loadWorkflow("deploy");
      expect(workflow.description).toBe("Custom deploy workflow");
    });

    it("handles non-existent user dir gracefully", async () => {
      const loader = createWorkflowLoader(["/nonexistent/dir", tmpDir]);
      const entries = await loader.loadRegistry();
      expect(entries).toHaveLength(2);
    });
  });

  describe("loadWorkflow", () => {
    it("loads and parses a workflow YAML", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      const workflow = await loader.loadWorkflow("minimal");
      expect(workflow.name).toBe("minimal");
      expect(workflow.phases).toHaveLength(3);
      expect(workflow.phases[0].id).toBe("run_script");
      expect(workflow.phases[0].type).toBe("script");
    });

    it("caches loaded workflows", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      const wf1 = await loader.loadWorkflow("minimal");
      const wf2 = await loader.loadWorkflow("minimal");
      expect(wf1).toBe(wf2); // same reference = cached
    });

    it("throws for missing workflow", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      await expect(loader.loadWorkflow("nonexistent")).rejects.toThrow(
        'Workflow "nonexistent" not found',
      );
    });
  });

  describe("bundled cleanup phases", () => {
    it("pass worktree and branch to cleanup-worktree.sh", async () => {
      const loader = createWorkflowLoader([join(process.cwd(), "workflows")]);

      for (const workflowName of ["standard", "manual-pr", "bugfix"]) {
        const cleanup = await loader.getPhase(workflowName, "cleanup");
        expect(cleanup.type).toBe("script");
        expect(cleanup.command).toBe("cleanup-worktree.sh");
        expect(cleanup.args).toEqual(["{{ worktree }}", "{{ branch }}"]);
      }
    });
  });

  describe("getPhase", () => {
    it("returns a specific phase definition", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      const phase = await loader.getPhase("minimal", "run_script");
      expect(phase.id).toBe("run_script");
      expect(phase.type).toBe("script");
      expect(phase.command).toBe("run.sh");
    });

    it("throws for missing phase", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      await expect(loader.getPhase("minimal", "missing")).rejects.toThrow(
        'Phase "missing" not found in workflow "minimal"',
      );
    });
  });

  describe("getNextPhase", () => {
    it("returns onSuccess target", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      const next = await loader.getNextPhase(
        "minimal",
        "run_script",
        "success",
      );
      expect(next).toBe("complete");
    });

    it("returns onFailure target", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      const next = await loader.getNextPhase(
        "minimal",
        "run_script",
        "failure",
      );
      expect(next).toBe("abort");
    });

    it("returns null when no transition defined", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      const next = await loader.getNextPhase("minimal", "complete", "success");
      expect(next).toBeNull();
    });
  });

  describe("clearCache", () => {
    it("clears cached workflows so they reload from disk", async () => {
      const loader = createWorkflowLoader([tmpDir]);
      await loader.loadWorkflow("minimal");

      // Modify the file on disk
      const updatedYaml = minimalYaml.replace(
        "Minimal test workflow",
        "Updated workflow",
      );
      await writeFile(join(tmpDir, "minimal.yaml"), updatedYaml);

      // Should still return cached
      const wf2 = await loader.loadWorkflow("minimal");
      expect(wf2.description).toBe("Minimal test workflow");

      // Clear and reload
      loader.clearCache();
      const wf3 = await loader.loadWorkflow("minimal");
      expect(wf3.description).toBe("Updated workflow");
    });
  });

  describe("invalid YAML", () => {
    it("throws on invalid workflow YAML", async () => {
      await writeFile(
        join(tmpDir, "bad.yaml"),
        "name: bad\nphases: not-array\n",
      );
      const loader = createWorkflowLoader([tmpDir]);
      await expect(loader.loadRegistry()).rejects.toThrow();
    });
  });
});
