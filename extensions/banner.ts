/**
 * Orchestrator Banner Extension
 *
 * Replaces the default PI header with an orchestrator-branded ASCII art banner
 * and quick-start instructions.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const ASCII_ART = [
  "  ___  ____   ____ _   _ _____ ____ _____ ____      _  _____ ___  ____  ",
  " / _ \\|  _ \\ / ___| | | | ____/ ___|_   _|  _ \\    / \\|_   _/ _ \\|  _ \\ ",
  "| | | | |_) | |   | |_| |  _| \\___ \\ | | | |_) |  / _ \\ | || | | | |_) |",
  "| |_| |  _ <| |___|  _  | |___ ___) || | |  _ <  / ___ \\| || |_| |  _ < ",
  " \\___/|_| \\_\\\\____|_| |_|_____|____/ |_| |_| \\_\\/_/   \\_\\_| \\___/|_| \\_\\",
];

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setHeader((_tui, theme) => ({
        render(width: number): string[] {
          const accent = (text: string) => theme.fg("accent", text);
          const muted = (text: string) => theme.fg("muted", text);
          const separator = "─".repeat(width);

          return [
            "",
            ...ASCII_ART.map((line) => accent(line)),
            "",
            separator,
            muted('  "Create a plan for PROJ-101"    "Add codex as an agent"'),
            muted('  "Show me available workflows"  "What repos are in my workspace?"'),
            separator,
          ];
        },
        invalidate() {},
      }));
    }
  });

  pi.registerCommand("default-header", {
    description: "Restore the default PI header",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Default header restored", "info");
    },
  });
}
