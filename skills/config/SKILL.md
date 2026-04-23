---
name: config
description: Read and modify the orchestrator configuration file
---

# Configuration Skill

This skill teaches you how to find, read, and modify the orchestrator's configuration file during an interactive session.

## Finding the Config File

The config file path is available via an environment variable:

```
$ORCHESTRATOR_CONFIG_PATH
```

This is always set when you are running inside `orchestrator interactive`. Read this file to understand the current configuration.

## Environment Variables Available

These environment variables are set during interactive sessions:

| Variable | Description |
|----------|-------------|
| `ORCHESTRATOR_CONFIG_PATH` | Absolute path to the active config file |
| `ORCHESTRATOR_STATE_DIR` | Resolved state directory (plan/ticket JSON files) |
| `ORCHESTRATOR_WORKFLOW_DIR` | Resolved workflow definitions directory |
| `ORCHESTRATOR_PROMPT_DIR` | Resolved prompt templates directory |
| `ORCHESTRATOR_SCRIPT_DIR` | Resolved scripts directory |
| `ORCHESTRATOR_SKILLS_DIR` | Resolved skills directory |
| `ORCHESTRATOR_REPO` | CWD where the interactive session was launched |
| `ORCHESTRATOR_MODE` | Always `"plan"` during interactive sessions |

## Config File Location

The config file is typically at one of these locations (checked in order):

1. `$ORCHESTRATOR_CONFIG_PATH` (always available in interactive mode)
2. `~/.orchestrator/config.yaml` (default after `orchestrator init`)
3. `./orchestrator.yaml` (CWD fallback for local dev)

## Config File Format

The config file is YAML. Here is the full schema:

```yaml
# Required: which agent to use by default
defaultAgent: claude

# Required: agent definitions
agents:
  claude:
    command: claude                          # CLI command to invoke
    defaultArgs:                             # default arguments
      - "--dangerously-skip-permissions"
  codex:
    command: codex
    defaultArgs:
      - "--approval-mode"
      - "never"
  pi:
    command: pi
    defaultArgs: []

# Optional: directory overrides (relative to config file location)
# If omitted, smart defaults apply:
#   stateDir, logDir → ~/.orchestrator/<name>
#   workflowDir, promptDir, scriptDir, skillsDir → bundled with package
stateDir: ./state
logDir: ./logs
workflowDir: ./workflows
promptDir: ./prompts
scriptDir: ./scripts
skillsDir: ./skills
postSetupWorktreeHooks:
  - pnpm install
  - pnpm run build

# Optional: runner settings
pollInterval: 10        # seconds between daemon ticks (default: 10)
maxConcurrency: 3       # max concurrent tickets (default: 3)
ghCommand: gh           # path to GitHub CLI (default: "gh")

# Optional: MCP servers passed to the interactive agent
mcpServers:
  linear:
    command: npx
    args: ["-y", "mcp-remote", "https://mcp.linear.app/mcp"]
    env:                                    # optional env vars for the server
      LINEAR_API_KEY: "${LINEAR_API_KEY}"   # ${VAR} syntax interpolates from process env
```

## Field Reference

### `defaultAgent` (string, required)

The agent name used when no override is specified at the plan, ticket, or phase level. Must match a key in `agents`.

### `agents` (object, required)

Map of agent name to agent config. Each agent has:

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | CLI command to invoke (e.g., `"claude"`, `"codex"`) |
| `defaultArgs` | string[] | Arguments always passed to this agent |

### `stateDir` (string, optional)

Where plan and ticket JSON files are stored. Default: `~/.orchestrator/state`.

### `logDir` (string, optional)

Where per-ticket execution logs are written. Default: `~/.orchestrator/logs`.

### `workflowDir` (string, optional)

Where YAML workflow definitions live. Default: bundled `workflows/` from the installed package. Override only if you have custom workflows outside the package.

### `promptDir` (string, optional)

Override for custom Nunjucks prompt templates directory. By default, `~/.orchestrator/prompts/` is automatically checked for custom templates (no config needed). Templates found there take priority over the bundled defaults. Set `promptDir` only if you want a different location. See `prompts/README.md` for available templates and variables.

### `scriptDir` (string, optional)

Where bash scripts for infrastructure phases live. Default: bundled `scripts/` from the installed package.

### `skillsDir` (string, optional)

Where skill documentation lives. Default: bundled `skills/` from the installed package.

### `postSetupWorktreeHooks` (string[], optional)

Ordered shell commands to run inside each newly created worktree after `git worktree add` succeeds. Default: `[]`.

Failures are logged but do not fail the setup phase, so use this for best-effort project bootstrap steps such as dependency installation or builds.

### `pollInterval` (number, optional)

Seconds between daemon ticks. Default: `10`.

### `maxConcurrency` (number, optional)

Maximum number of tickets the daemon processes in parallel. Default: `3`.

### `ghCommand` (string, optional)

Path or name of the GitHub CLI. Default: `"gh"`.

### `mcpServers` (object, optional)

MCP servers to make available during interactive sessions. Each entry:

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Command to start the MCP server |
| `args` | string[] | Arguments for the command |
| `env` | object | Environment variables. `${VAR}` syntax interpolates from the process environment. |

## Common Modifications

### Adding a New Agent

To add a new agent (e.g., a custom agent or a different provider):

```yaml
agents:
  # ... existing agents ...
  my-agent:
    command: my-agent-cli
    defaultArgs:
      - "--some-flag"
```

Then optionally set it as default:

```yaml
defaultAgent: my-agent
```

### Changing Concurrency

```yaml
maxConcurrency: 5
```

### Adding an MCP Server

```yaml
mcpServers:
  # ... existing servers ...
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
```

### Overriding Bundled Directories

If you have custom workflows or scripts outside the package:

```yaml
workflowDir: /path/to/my/workflows
```

Paths are resolved relative to the config file location. Absolute paths also work.

### Running Project Bootstrap Commands After Worktree Setup

```yaml
postSetupWorktreeHooks:
  - pnpm install
  - pnpm run build
```

Hooks run in order from inside the created worktree. If one fails, the failure is logged and the workflow still continues.

### Customizing Prompt Templates

Drop custom templates into `~/.orchestrator/prompts/` — they're picked up automatically. Only override the templates you want to change; all others fall back to bundled defaults.

```sh
mkdir -p ~/.orchestrator/prompts
# Copy and edit the template you want to customize
```

To use a different directory, set `promptDir` in config:

```yaml
promptDir: ~/my-prompts
```

See `prompts/README.md` for the full list of templates and available template variables.

## How to Modify the Config

1. Read the current config: `cat $ORCHESTRATOR_CONFIG_PATH`
2. Edit the YAML file at `$ORCHESTRATOR_CONFIG_PATH`
3. Changes take effect the next time a command loads the config (no restart needed for the daemon — it reloads on each tick)

## Validation

The config is validated with a Zod schema on load. If you make a mistake:

- Missing `defaultAgent` or `agents` → load error
- Unknown fields are silently ignored
- Directory fields accept any string (resolved to absolute paths on load)
- `pollInterval`, `maxConcurrency` must be numbers if present
