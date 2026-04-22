import { execSync } from "node:child_process";

export interface SessionReference {
  provider: string;
  sessionId: string;
}

export function buildResumeArgs(session: SessionReference): string[] {
  if (session.provider === "codex") {
    return ["resume", session.sessionId];
  }
  return ["--resume", session.sessionId];
}

export function getResumeCommand(session: SessionReference): string {
  return session.provider === "codex" ? "codex" : "claude";
}

export function buildResumeCommand(session: SessionReference): string {
  return `${getResumeCommand(session)} ${buildResumeArgs(session).join(" ")}`;
}

export function copyTextToClipboard(text: string): boolean {
  const commands =
    process.platform === "darwin"
      ? ["pbcopy"]
      : process.platform === "linux"
        ? ["xclip -selection clipboard", "xsel --clipboard --input"]
        : process.platform === "win32"
          ? ["clip"]
          : [
              "pbcopy",
              "xclip -selection clipboard",
              "xsel --clipboard --input",
              "clip",
            ];

  for (const command of commands) {
    try {
      execSync(command, {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
      });
      return true;
    } catch {
      // Try the next clipboard integration.
    }
  }

  return false;
}

export function copyResumeCommandToClipboard(
  session: SessionReference,
): boolean {
  return copyTextToClipboard(buildResumeCommand(session));
}
