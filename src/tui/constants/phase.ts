import type { PhaseId } from "../types/phase.js";

export const PHASE_LABELS: Record<PhaseId, string> = {
  setup: "Setup",
  implement: "Implement",
  self_review: "Self Review",
  simplify: "Simplify",
  verify: "Verify",
  create_pr: "Create PR",
  await_review: "Awaiting Review",
  route_review: "Routing Review",
  handle_review: "Handle Review",
  await_pr: "Awaiting PR",
  await_merge: "Awaiting Merge",
  route_merge_failure: "Merge Failed",
  route_review_failure: "Review Failed",
  abort: "Aborted",
  escalate: "Escalate",
  cleanup: "Cleanup",
  complete: "Complete",
  pr_closed: "PR Closed",
  run_script: "Running Script",
};
