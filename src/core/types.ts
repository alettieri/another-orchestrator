import { z } from "zod";

// --- Agent & Config ---

export const AgentConfigSchema = z.object({
  command: z.string(),
  defaultArgs: z.array(z.string()),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// Raw schema: what the YAML config file contains (directory fields optional)
export const RawOrchestratorConfigSchema = z.object({
  defaultAgent: z.string(),
  agents: z.record(z.string(), AgentConfigSchema),
  stateDir: z.string().optional(),
  logDir: z.string().optional(),
  workflowDir: z.string().optional(),
  promptDir: z.string().optional(),
  scriptDir: z.string().optional(),
  skillsDir: z.string().optional(),
  pollInterval: z.number().default(10),
  maxConcurrency: z.number().default(3),
  ghCommand: z.string().default("gh"),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
});

export type RawOrchestratorConfig = z.infer<typeof RawOrchestratorConfigSchema>;

// Resolved schema: all directories are resolved to absolute paths
export const OrchestratorConfigSchema = z.object({
  defaultAgent: z.string(),
  agents: z.record(z.string(), AgentConfigSchema),
  stateDir: z.string(),
  logDir: z.string(),
  workflowDir: z.string(),
  workflowSearchPath: z.array(z.string()),
  promptDir: z.string(),
  promptSearchPath: z.array(z.string()),
  scriptDir: z.string(),
  skillsDir: z.string(),
  pollInterval: z.number().default(10),
  maxConcurrency: z.number().default(3),
  ghCommand: z.string().default("gh"),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
});

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;

// --- Plan ---

export const PlanTicketEntrySchema = z.object({
  ticketId: z.string(),
  order: z.number(),
  blockedBy: z.array(z.string()).default([]),
});

export type PlanTicketEntry = z.infer<typeof PlanTicketEntrySchema>;

export const PlanStatusSchema = z.enum(["active", "paused", "complete"]);

export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  repo: z.string().nullable().default(null),
  workflow: z.string(),
  agent: z.string().nullable().default(null),
  worktreeRoot: z.string(),
  status: PlanStatusSchema,
  tickets: z.array(PlanTicketEntrySchema),
});

export type PlanFile = z.infer<typeof PlanFileSchema>;

// --- Ticket ---

export const TicketStatusSchema = z.enum([
  "queued",
  "ready",
  "running",
  "paused",
  "complete",
  "failed",
  "needs_attention",
]);

export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const PhaseHistoryEntrySchema = z.object({
  phase: z.string(),
  status: z.enum(["success", "failure", "skipped"]),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  output: z.string().optional(),
  sessionId: z.string().optional(),
});

export type PhaseHistoryEntry = z.infer<typeof PhaseHistoryEntrySchema>;

export const TicketStateSchema = z.object({
  planId: z.string(),
  ticketId: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).default([]),
  linearUrl: z.string().nullable().default(null),
  repo: z.string().nullable().default(null),
  workflow: z.string(),
  branch: z.string(),
  worktree: z.string(),
  agent: z.string().nullable().default(null),
  status: TicketStatusSchema,
  currentPhase: z.string(),
  phaseHistory: z.array(PhaseHistoryEntrySchema).default([]),
  context: z.record(z.string(), z.string()).default({}),
  retries: z.record(z.string(), z.number()).default({}),
  error: z.string().nullable().default(null),
});

export type TicketState = z.infer<typeof TicketStateSchema>;

// --- Workflow ---

export const PhaseTypeSchema = z.enum(["script", "agent", "poll", "terminal"]);

export type PhaseType = z.infer<typeof PhaseTypeSchema>;

export const PhaseDefinitionSchema = z.object({
  id: z.string(),
  type: PhaseTypeSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional().default([]),
  promptTemplate: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  maxTurns: z.number().optional(),
  maxRetries: z.number().optional().default(0),
  agent: z.string().nullable().optional(),
  intervalSeconds: z.number().optional(),
  timeoutSeconds: z.number().optional(),
  capture: z.record(z.string(), z.string()).optional(),
  notify: z.boolean().optional().default(false),
  onSuccess: z.string().optional(),
  onFailure: z.string().optional(),
});

export type PhaseDefinition = z.infer<typeof PhaseDefinitionSchema>;

export const WorkflowDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  tags: z.array(z.string()).default([]),
  phases: z.array(PhaseDefinitionSchema),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const WorkflowRegistryEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
});

export type WorkflowRegistryEntry = z.infer<typeof WorkflowRegistryEntrySchema>;
