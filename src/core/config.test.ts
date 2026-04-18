import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findConfigFile,
  loadConfig,
  resolveAgent,
  resolveOrchestratorHome,
} from "./config.js";
import type { OrchestratorConfig } from "./types.js";

const minimalYaml = `
defaultAgent: claude
agents:
  claude:
    command: claude
    defaultArgs: []
`;

const fullYaml = `
defaultAgent: claude
agents:
  claude:
    command: claude
    defaultArgs: []
stateDir: ./state
logDir: ./logs
workflowDir: ./workflows
promptDir: ./prompts
scriptDir: ./scripts
skillsDir: ./skills
`;

describe("resolveOrchestratorHome", () => {
  afterEach(() => {
    delete process.env.ORCHESTRATOR_HOME;
  });

  it("returns ~/.orchestrator by default", () => {
    delete process.env.ORCHESTRATOR_HOME;
    expect(resolveOrchestratorHome()).toBe(join(homedir(), ".orchestrator"));
  });

  it("respects ORCHESTRATOR_HOME env var", () => {
    process.env.ORCHESTRATOR_HOME = "/custom/home";
    expect(resolveOrchestratorHome()).toBe("/custom/home");
  });
});

describe("findConfigFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = resolve(
      tmpdir(),
      `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env.ORCHESTRATOR_HOME;
  });

  it("returns explicit path when it exists", async () => {
    const configPath = join(tmpDir, "custom.yaml");
    await writeFile(configPath, minimalYaml);
    expect(findConfigFile(configPath)).toBe(configPath);
  });

  it("throws when explicit path does not exist", () => {
    expect(() => findConfigFile(join(tmpDir, "nope.yaml"))).toThrow(
      "Config file not found",
    );
  });

  it("finds config in ORCHESTRATOR_HOME", async () => {
    process.env.ORCHESTRATOR_HOME = tmpDir;
    const configPath = join(tmpDir, "config.yaml");
    await writeFile(configPath, minimalYaml);
    expect(findConfigFile()).toBe(configPath);
  });

  it("throws descriptive error when no config found", () => {
    process.env.ORCHESTRATOR_HOME = join(tmpDir, "empty-home");
    // chdir to a directory without orchestrator.yaml to avoid CWD fallback
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      expect(() => findConfigFile()).toThrow("No config file found");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("loadConfig", () => {
  let tmpDir: string;
  let pkgDir: string;

  beforeEach(async () => {
    tmpDir = resolve(
      tmpdir(),
      `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    pkgDir = join(tmpDir, "package");
    await mkdir(tmpDir, { recursive: true });
    await mkdir(pkgDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env.ORCHESTRATOR_HOME;
  });

  it("loads and validates a YAML config with explicit dirs", async () => {
    const configPath = join(tmpDir, "orchestrator.yaml");
    await writeFile(configPath, fullYaml);

    const config = await loadConfig({ configPath, packageDir: pkgDir });
    expect(config.defaultAgent).toBe("claude");
    expect(config.orchestratorHome).toBe(resolveOrchestratorHome());
    expect(config.pollInterval).toBe(10);
    expect(config.maxConcurrency).toBe(3);
  });

  it("resolves explicit relative paths based on config dir", async () => {
    const configPath = join(tmpDir, "orchestrator.yaml");
    await writeFile(configPath, fullYaml);

    const config = await loadConfig({ configPath, packageDir: pkgDir });
    expect(config.stateDir).toBe(join(tmpDir, "state"));
    expect(config.logDir).toBe(join(tmpDir, "logs"));
    expect(config.workflowDir).toBe(join(tmpDir, "workflows"));
    expect(config.promptDir).toBe(join(tmpDir, "prompts"));
    expect(config.scriptDir).toBe(join(tmpDir, "scripts"));
    expect(config.skillsDir).toBe(join(tmpDir, "skills"));
  });

  it("builds promptSearchPath with custom dir first and bundled fallback", async () => {
    const configPath = join(tmpDir, "orchestrator.yaml");
    await writeFile(configPath, fullYaml);

    const config = await loadConfig({ configPath, packageDir: pkgDir });
    expect(config.promptSearchPath).toEqual([
      join(tmpDir, "prompts"),
      join(pkgDir, "prompts"),
    ]);
  });

  it("builds workflowSearchPath with custom dir first and bundled fallback", async () => {
    const configPath = join(tmpDir, "orchestrator.yaml");
    await writeFile(configPath, fullYaml);

    const config = await loadConfig({ configPath, packageDir: pkgDir });
    expect(config.workflowSearchPath).toEqual([
      join(tmpDir, "workflows"),
      join(pkgDir, "workflows"),
    ]);
  });

  it("applies smart defaults when dirs are omitted", async () => {
    process.env.ORCHESTRATOR_HOME = join(tmpDir, "home");
    await mkdir(join(tmpDir, "home"), { recursive: true });

    const configPath = join(tmpDir, "home", "config.yaml");
    await writeFile(configPath, minimalYaml);

    const config = await loadConfig({ configPath, packageDir: pkgDir });

    // User data dirs default to home
    expect(config.orchestratorHome).toBe(join(tmpDir, "home"));
    expect(config.stateDir).toBe(join(tmpDir, "home", "state"));
    expect(config.logDir).toBe(join(tmpDir, "home", "logs"));

    // Bundled dirs default to packageDir (except convention-based ones)
    expect(config.scriptDir).toBe(join(pkgDir, "scripts"));
    expect(config.skillsDir).toBe(join(pkgDir, "skills"));

    // promptDir defaults to ~/.orchestrator/prompts/ (convention-based)
    expect(config.promptDir).toBe(join(tmpDir, "home", "prompts"));

    // workflowDir defaults to ~/.orchestrator/workflows/ (convention-based)
    expect(config.workflowDir).toBe(join(tmpDir, "home", "workflows"));

    // Search paths: home dir first, bundled fallback
    expect(config.promptSearchPath).toEqual([
      join(tmpDir, "home", "prompts"),
      join(pkgDir, "prompts"),
    ]);
    expect(config.workflowSearchPath).toEqual([
      join(tmpDir, "home", "workflows"),
      join(pkgDir, "workflows"),
    ]);
  });

  it("throws on invalid YAML", async () => {
    const configPath = join(tmpDir, "bad.yaml");
    await writeFile(configPath, "not: [valid: yaml: {{{}}}");

    await expect(
      loadConfig({ configPath, packageDir: pkgDir }),
    ).rejects.toThrow();
  });

  it("throws on missing required fields", async () => {
    const configPath = join(tmpDir, "missing.yaml");
    await writeFile(configPath, "pollInterval: 10\n");

    await expect(
      loadConfig({ configPath, packageDir: pkgDir }),
    ).rejects.toThrow();
  });

  it("throws on missing file", async () => {
    await expect(
      loadConfig({
        configPath: join(tmpDir, "nonexistent.yaml"),
        packageDir: pkgDir,
      }),
    ).rejects.toThrow("Config file not found");
  });
});

describe("resolveAgent", () => {
  const config: OrchestratorConfig = {
    defaultAgent: "claude",
    agents: {
      claude: { command: "claude", defaultArgs: [] },
      codex: { command: "codex", defaultArgs: [] },
    },
    orchestratorHome: "/tmp/orchestrator",
    stateDir: "/tmp/state",
    logDir: "/tmp/logs",
    workflowDir: "/tmp/workflows",
    workflowSearchPath: ["/tmp/workflows"],
    promptDir: "/tmp/prompts",
    promptSearchPath: ["/tmp/prompts"],
    scriptDir: "/tmp/scripts",
    skillsDir: "/tmp/skills",
    pollInterval: 10,
    maxConcurrency: 3,
    ghCommand: "gh",
  };

  it("returns phase agent when specified", () => {
    expect(resolveAgent(config, "codex", null, null)).toBe("codex");
  });

  it("falls back to ticket agent", () => {
    expect(resolveAgent(config, null, "codex", null)).toBe("codex");
  });

  it("falls back to plan agent", () => {
    expect(resolveAgent(config, null, null, "codex")).toBe("codex");
  });

  it("falls back to default agent", () => {
    expect(resolveAgent(config, null, null, null)).toBe("claude");
  });

  it("respects priority: phase > ticket > plan > default", () => {
    expect(resolveAgent(config, "codex", "claude", "claude")).toBe("codex");
  });

  it("throws if resolved agent is not in config", () => {
    expect(() => resolveAgent(config, "unknown", null, null)).toThrow(
      'Agent "unknown" not found',
    );
  });
});
