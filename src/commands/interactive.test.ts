import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./interactive.js";

vi.mock("../agents/interactive.js", async () => {
  const actual = await vi.importActual<
    typeof import("../agents/interactive.js")
  >("../agents/interactive.js");
  return {
    ...actual,
    spawnInteractive: vi.fn(),
  };
});

import { spawnInteractive } from "../agents/interactive.js";

const mockSpawnInteractive = vi.mocked(spawnInteractive);
const tempDirs: string[] = [];
const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orchestrator-interactive-cmd-"));
  tempDirs.push(dir);
  return dir;
}

async function writeConfig(dir: string): Promise<string> {
  const configPath = join(dir, "config.yaml");
  await writeFile(
    configPath,
    [
      "defaultAgent: codex",
      "agents:",
      "  codex:",
      "    command: codex",
      '    defaultArgs: ["--model", "gpt-5.2"]',
      "  claude:",
      "    command: claude",
      '    defaultArgs: ["--verbose"]',
      `stateDir: ${JSON.stringify(join(dir, "state"))}`,
      `logDir: ${JSON.stringify(join(dir, "logs"))}`,
      `workflowDir: ${JSON.stringify(join(dir, "workflows"))}`,
      `promptDir: ${JSON.stringify(join(dir, "prompts"))}`,
      `scriptDir: ${JSON.stringify(join(dir, "scripts"))}`,
      `skillsDir: ${JSON.stringify(join(dir, "skills"))}`,
      "",
    ].join("\n"),
  );
  return configPath;
}

async function writeUnsupportedAgentConfig(dir: string): Promise<string> {
  const configPath = join(dir, "config.yaml");
  await writeFile(
    configPath,
    [
      "defaultAgent: gemini",
      "agents:",
      "  gemini:",
      "    command: gemini",
      "    defaultArgs: []",
      `stateDir: ${JSON.stringify(join(dir, "state"))}`,
      `logDir: ${JSON.stringify(join(dir, "logs"))}`,
      `workflowDir: ${JSON.stringify(join(dir, "workflows"))}`,
      `promptDir: ${JSON.stringify(join(dir, "prompts"))}`,
      `scriptDir: ${JSON.stringify(join(dir, "scripts"))}`,
      `skillsDir: ${JSON.stringify(join(dir, "skills"))}`,
      "",
    ].join("\n"),
  );
  return configPath;
}

function makeProgram(configPath: string): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} });
  register(program, () => ({ configPath, packageDir: "/tmp/package" }));
  return program;
}

describe("interactive command", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    mockSpawnInteractive.mockResolvedValue(0);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("uses defaultAgent when --launcher is omitted", async () => {
    const dir = await createTempDir();
    const configPath = await writeConfig(dir);
    const program = makeProgram(configPath);

    await program.parseAsync(["node", "test", "interactive"], {
      from: "node",
    });

    expect(mockSpawnInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "codex",
        command: "codex",
        args: ["--model", "gpt-5.2"],
      }),
    );
    expect(logSpy.mock.calls.flat()).toContain("  Launcher: codex");
  });

  it("lets --launcher override defaultAgent", async () => {
    const dir = await createTempDir();
    const configPath = await writeConfig(dir);
    const program = makeProgram(configPath);

    await program.parseAsync(
      ["node", "test", "interactive", "--launcher", "claude"],
      {
        from: "node",
      },
    );

    expect(mockSpawnInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subprocess",
        agentName: "claude",
        command: "claude",
        args: expect.arrayContaining(["--verbose", "--add-dir"]),
      }),
    );
  });

  it("rejects the removed --agent option", async () => {
    const program = makeProgram("/tmp/config.yaml");

    await expect(
      program.parseAsync(["node", "test", "interactive", "--agent", "claude"], {
        from: "node",
      }),
    ).rejects.toThrow("error: unknown option '--agent'");

    expect(mockSpawnInteractive).not.toHaveBeenCalled();
  });

  it("uses generic fallback for configured agents without built-in launchers", async () => {
    const dir = await createTempDir();
    const configPath = await writeUnsupportedAgentConfig(dir);
    const program = makeProgram(configPath);

    await program.parseAsync(["node", "test", "interactive"], {
      from: "node",
    });

    expect(mockSpawnInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subprocess",
        agentName: "gemini",
        command: "gemini",
        args: [],
      }),
    );
  });

  it("describes interactive planning without Claude-only wording", () => {
    const program = makeProgram("/tmp/config.yaml");
    const help = program.helpInformation().replace(/\s+/g, " ");
    const commandHelp = program.commands
      .find((command) => command.name() === "interactive")
      ?.helpInformation()
      .replace(/\s+/g, " ");

    expect(help).toContain(
      "Launch an interactive planning and configuration session",
    );
    expect(commandHelp).toContain("--launcher <name>");
    expect(commandHelp).toContain("Override default interactive launcher");
    expect(commandHelp).not.toContain("--agent <name>");
    expect(help).not.toContain("interactive Claude session");
  });
});
