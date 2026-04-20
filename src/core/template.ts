import nunjucks from "nunjucks";
import type { TicketState } from "./types.js";

export interface TemplateRenderer {
  render(templateFile: string, ticket: TicketState): string;
  renderString(template: string, ticket: TicketState): string;
}

function buildContext(ticket: TicketState): Record<string, unknown> {
  const acceptanceCriteriaList = ticket.acceptanceCriteria
    .map((c) => `- ${c}`)
    .join("\n");

  return {
    ...ticket.context,
    ...ticket,
    acceptance_criteria_list: acceptanceCriteriaList,
    linearUrl: ticket.linearUrl ?? "",
  };
}

export function createTemplateRenderer(
  promptDirs: string | string[],
): TemplateRenderer {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(promptDirs),
    {
      autoescape: false,
      throwOnUndefined: false,
    },
  );

  return {
    render(templateFile, ticket) {
      const ctx = buildContext(ticket);
      return env.render(templateFile, ctx);
    },

    renderString(template, ticket) {
      const ctx = buildContext(ticket);
      return env.renderString(template, ctx);
    },
  };
}
