# Implementation Task

## Ticket: {{ ticketId }}

**{{ title }}**

{{ description }}

{% if acceptance_criteria_list %}
## Acceptance Criteria

{{ acceptance_criteria_list }}
{% endif %}

## Working Directory

You are working in: `{{ worktree }}`
Branch: `{{ branch }}`
Repository: `{{ repo }}`

{% if linearUrl %}
Linear issue: {{ linearUrl }}
{% endif %}

{% if context.self_review_feedback %}
## Self-Review Feedback

A previous self-review found the following issues. Address these:

{{ context.self_review_feedback }}
{% endif %}

## Instructions

1. Read and understand the ticket requirements above.
2. Explore the codebase to understand the relevant code and patterns.
3. Implement the changes described in the ticket.
4. Ensure your code follows the project's existing conventions and style.
5. Run any available linters and fix issues before finishing.
6. Run the project's test suite and ensure all tests pass.
7. If new functionality is added, write tests for it.
8. Do not commit your changes — the orchestrator will handle that.
