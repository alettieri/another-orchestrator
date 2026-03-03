# Handle Review Comments

## Ticket: {{ ticketId }}

**{{ title }}**

## Working Directory

You are working in: `{{ worktree }}`
Branch: `{{ branch }}`
Repository: `{{ repo }}`

## Pull Request

PR URL: {{ context.pr_url }}
PR Number: {{ context.pr_number }}

## Instructions

1. Check for review comments and CI failures:
   - Review comments: `gh pr view {{ context.pr_number }} --comments`
   - Detailed reviews: `gh api repos/{owner}/{repo}/pulls/{{ context.pr_number }}/reviews`
   - Inline comments: `gh api repos/{owner}/{repo}/pulls/{{ context.pr_number }}/comments`
   - CI status: `gh pr checks {{ context.pr_number }}`
2. For each review comment or requested change:
   - Understand what the reviewer is asking for.
   - Make the necessary code changes to address the feedback.
3. If CI checks are failing:
   - Read the failing check logs to understand what went wrong.
   - Fix the issues (lint errors, type errors, test failures, build failures).
4. After addressing each inline review comment, resolve the conversation thread using the GraphQL API:
   ```bash
   gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }' -F id="<THREAD_NODE_ID>"
   ```
   To get thread node IDs, query:
   ```bash
   gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { body } } } } } } }' -F owner="{owner}" -F repo="{repo}" -F number={{ context.pr_number }}
   ```
5. Run the linter, type checker, and test suite to ensure everything passes.
6. Stage all changes, commit with message "Address review feedback for {{ ticketId }}", and push to the remote branch.
