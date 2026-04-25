import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OrchestratorConfig } from "../core/types.js";

export interface NormalizedMcpServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpLaunchData {
  args: string[];
  artifactPaths: string[];
}

export interface PreparedMcpLaunch {
  servers: NormalizedMcpServer[];
  launchData: McpLaunchData;
  warnings: string[];
}

export interface PrepareMcpLaunchOptions {
  config: OrchestratorConfig;
  provider: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

type ClaudeMcpConfig = {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  >;
};

function isTranslatableServer(server: NormalizedMcpServer): boolean {
  return server.command.trim().length > 0;
}

function skippedServerWarning(
  provider: string,
  server: NormalizedMcpServer,
  reason: string,
): string {
  return `Skipping MCP server "${server.name}" for provider "${provider}": ${reason}`;
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function toTomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : toTomlString(value);
}

export function normalizeMcpServers(
  config: OrchestratorConfig,
  env: NodeJS.ProcessEnv = process.env,
): NormalizedMcpServer[] {
  return Object.entries(config.mcpServers ?? {}).map(([name, server]) => {
    const normalized: NormalizedMcpServer = {
      name,
      command: server.command,
      args: [...server.args],
    };

    if (server.env) {
      normalized.env = Object.fromEntries(
        Object.entries(server.env).map(([key, value]) => [
          key,
          value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
            return env[varName] ?? "";
          }),
        ]),
      );
    }

    return normalized;
  });
}

export async function prepareMcpLaunch(
  opts: PrepareMcpLaunchOptions,
): Promise<PreparedMcpLaunch> {
  const servers = normalizeMcpServers(opts.config, opts.env);
  const emptyLaunchData: McpLaunchData = { args: [], artifactPaths: [] };

  if (servers.length === 0) {
    return { servers, launchData: emptyLaunchData, warnings: [] };
  }

  if (opts.provider === "claude") {
    const mcpConfig: ClaudeMcpConfig = { mcpServers: {} };
    const warnings: string[] = [];

    for (const server of servers) {
      if (!isTranslatableServer(server)) {
        warnings.push(
          skippedServerWarning(opts.provider, server, "command is required"),
        );
        continue;
      }

      const entry: ClaudeMcpConfig["mcpServers"][string] = {
        command: server.command,
        args: server.args,
      };
      if (server.env) {
        entry.env = server.env;
      }
      mcpConfig.mcpServers[server.name] = entry;
    }

    if (Object.keys(mcpConfig.mcpServers).length === 0) {
      return {
        servers,
        launchData: emptyLaunchData,
        warnings,
      };
    }

    const mcpJsonDir = join(opts.cwd, ".claude");
    const mcpJsonPath = join(mcpJsonDir, "mcp.json");
    await mkdir(mcpJsonDir, { recursive: true });
    await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));

    return {
      servers,
      launchData: {
        args: ["--mcp-config", mcpJsonPath],
        artifactPaths: [mcpJsonPath],
      },
      warnings,
    };
  }

  if (opts.provider === "codex") {
    const args: string[] = [];
    const warnings: string[] = [];

    for (const server of servers) {
      if (!isTranslatableServer(server)) {
        warnings.push(
          skippedServerWarning(opts.provider, server, "command is required"),
        );
        continue;
      }

      const serverKey = `mcp_servers.${toTomlKeySegment(server.name)}`;
      args.push("-c", `${serverKey}.command=${toTomlString(server.command)}`);
      args.push(
        "-c",
        `${serverKey}.args=[${server.args.map(toTomlString).join(", ")}]`,
      );

      for (const [key, value] of Object.entries(server.env ?? {})) {
        args.push(
          "-c",
          `${serverKey}.env.${toTomlKeySegment(key)}=${toTomlString(value)}`,
        );
      }
    }

    return {
      servers,
      launchData: {
        args,
        artifactPaths: [],
      },
      warnings,
    };
  }

  return {
    servers,
    launchData: emptyLaunchData,
    warnings: [`MCP servers are not supported for provider "${opts.provider}"`],
  };
}
