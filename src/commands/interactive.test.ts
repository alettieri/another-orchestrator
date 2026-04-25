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

function makeProgram(configPath: string): Command {
  const program = new Command();
  program.exitOverride();
  register(program, () => ({ configPath, packageDir: "/tmp/package" }));
  return program;
}

describe("interactive command", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

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

  it("uses defaultAgent when --agent is omitted", async () => {
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
  });

  it("lets --agent override defaultAgent", async () => {
    const dir = await createTempDir();
    const configPath = await writeConfig(dir);
    const program = makeProgram(configPath);

    await program.parseAsync(
      ["node", "test", "interactive", "--agent", "claude"],
      {
        from: "node",
      },
    );

    expect(mockSpawnInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "claude",
        command: "claude",
        args: expect.arrayContaining(["--verbose", "--add-dir"]),
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
    expect(commandHelp).toContain("--agent <name>");
    expect(help).not.toContain("interactive Claude session");
  });
});
