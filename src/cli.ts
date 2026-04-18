#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { register as registerImport } from "./commands/import.js";
import { register as registerInit } from "./commands/init.js";
import { register as registerInteractive } from "./commands/interactive.js";
import { register as registerRun } from "./commands/run.js";
import { register as registerSessions } from "./commands/sessions.js";
import { register as registerStatus } from "./commands/status.js";
import { register as registerTickets } from "./commands/tickets.js";
import { register as registerTui } from "./commands/tui.js";
import type { LoadConfigOptions } from "./core/config.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const program = new Command();
program
  .name("orchestrator")
  .description("CLI-driven orchestrator for managing agent workflows")
  .version("0.1.0")
  .option("-C, --config <path>", "Path to config file");

function getConfigOptions(): LoadConfigOptions {
  const opts = program.opts<{ config?: string }>();
  return { configPath: opts.config, packageDir };
}

registerInit(program, getConfigOptions);
registerImport(program, getConfigOptions);
registerStatus(program, getConfigOptions);
registerRun(program, getConfigOptions);
registerTickets(program, getConfigOptions);
registerSessions(program, getConfigOptions);
registerInteractive(program, getConfigOptions);
registerTui(program, getConfigOptions);

program.parse();
