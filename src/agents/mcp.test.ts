import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OrchestratorConfig } from "../core/types.js";
import { normalizeMcpServers, prepareMcpLaunch } from "./mcp.js";

const mockConfig: OrchestratorConfig = {
  defaultAgent: "claude",
  agents: {
    claude: { command: "claude", defaultArgs: [] },
  },
  orchestratorHome: "/abs/home",
  stateDir: "/abs/state",
  logDir: "/abs/logs",
  workflowDir: "/abs/workflows",
  workflowSearchPath: ["/abs/workflows"],
  promptDir: "/abs/prompts",
  promptSearchPath: ["/abs/prompts"],
  scriptDir: "/abs/scripts",
  skillsDir: "/abs/skills",
  pollInterval: 10,
  maxConcurrency: 3,
  ghCommand: "gh",
};

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orchestrator-mcp-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("normalizeMcpServers", () => {
  it("normalizes configured MCP servers", () => {
    const servers = normalizeMcpServers({
      ...mockConfig,
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/repo"],
        },
      },
    });

    expect(servers).toEqual([
      {
        name: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/repo"],
      },
    ]);
  });

  it("interpolates environment references", () => {
    const servers = normalizeMcpServers(
      {
        ...mockConfig,
        mcpServers: {
          linear: {
            command: "linear-mcp",
            args: [],
            env: {
              TOKEN: "$" + "{MCP_TOKEN}",
              URL: "https://" + "$" + "{MCP_HOST}/mcp",
              MISSING: "$" + "{DOES_NOT_EXIST}",
            },
          },
        },
      },
      { MCP_TOKEN: "secret-token", MCP_HOST: "linear.example" },
    );

    expect(servers[0].env).toEqual({
      TOKEN: "secret-token",
      URL: "https://linear.example/mcp",
      MISSING: "",
    });
  });
});

describe("prepareMcpLaunch", () => {
  it("writes Claude MCP launch artifacts", async () => {
    const repoDir = await createTempDir();
    const result = await prepareMcpLaunch({
      config: {
        ...mockConfig,
        mcpServers: {
          linear: {
            command: "linear-mcp",
            args: ["--stdio"],
            env: { TOKEN: "$" + "{MCP_TOKEN}" },
          },
        },
      },
      provider: "claude",
      cwd: repoDir,
      env: { MCP_TOKEN: "secret-token" },
    });

    const mcpConfigPath = join(repoDir, ".claude", "mcp.json");
    expect(result.launchData).toEqual({
      args: ["--mcp-config", mcpConfigPath],
      artifactPaths: [mcpConfigPath],
    });
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(await readFile(mcpConfigPath, "utf-8"))).toEqual({
      mcpServers: {
        linear: {
          command: "linear-mcp",
          args: ["--stdio"],
          env: { TOKEN: "secret-token" },
        },
      },
    });
  });

  it("returns no artifacts when no MCP servers are configured", async () => {
    const repoDir = await createTempDir();
    const result = await prepareMcpLaunch({
      config: mockConfig,
      provider: "claude",
      cwd: repoDir,
    });

    expect(result).toEqual({
      servers: [],
      launchData: { args: [], artifactPaths: [] },
      warnings: [],
    });
    await expect(
      access(join(repoDir, ".claude", "mcp.json")),
    ).rejects.toThrow();
  });

  it("renders Codex MCP launch args", async () => {
    const repoDir = await createTempDir();
    const result = await prepareMcpLaunch({
      config: {
        ...mockConfig,
        mcpServers: {
          "linear-prod": {
            command: "linear-mcp",
            args: ["--stdio"],
            env: { TOKEN: "$" + "{MCP_TOKEN}" },
          },
        },
      },
      provider: "codex",
      cwd: repoDir,
      env: { MCP_TOKEN: "secret-token" },
    });

    expect(result.launchData).toEqual({
      args: [
        "-c",
        'mcp_servers.linear-prod.command="linear-mcp"',
        "-c",
        'mcp_servers.linear-prod.args=["--stdio"]',
        "-c",
        'mcp_servers.linear-prod.env.TOKEN="secret-token"',
      ],
      artifactPaths: [],
    });
    expect(result.warnings).toEqual([]);
    await expect(
      access(join(repoDir, ".claude", "mcp.json")),
    ).rejects.toThrow();
  });

  it("skips untranslatable servers with provider-specific warnings", async () => {
    const repoDir = await createTempDir();
    const result = await prepareMcpLaunch({
      config: {
        ...mockConfig,
        mcpServers: {
          broken: { command: "", args: [] },
          linear: { command: "linear-mcp", args: [] },
        },
      },
      provider: "codex",
      cwd: repoDir,
    });

    expect(result.launchData.args).toEqual([
      "-c",
      'mcp_servers.linear.command="linear-mcp"',
      "-c",
      "mcp_servers.linear.args=[]",
    ]);
    expect(result.warnings).toEqual([
      'Skipping MCP server "broken" for provider "codex": command is required',
    ]);
  });

  it("returns a warning and no launch data for unsupported providers", async () => {
    const repoDir = await createTempDir();
    const result = await prepareMcpLaunch({
      config: {
        ...mockConfig,
        mcpServers: {
          linear: { command: "linear-mcp", args: [] },
        },
      },
      provider: "gemini",
      cwd: repoDir,
    });

    expect(result.launchData).toEqual({ args: [], artifactPaths: [] });
    expect(result.warnings).toEqual([
      'MCP servers are not supported for provider "gemini"',
    ]);
  });
});
