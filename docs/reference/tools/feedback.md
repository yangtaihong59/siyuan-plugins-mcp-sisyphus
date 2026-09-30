# Feedback Tool

Use the `feedback` tool to submit plain-text product feedback to the plugin developer.

## Submission in strict mode

After the user authorizes the content, call `submit` without `validateOnly`, `requestId`, or hash credentials. Feedback goes to an external WPS form, so note-state preflight and replay guarantees do not apply. The response reports `safety.writeSafetyGuaranteed: false`.

Passing `validateOnly: true` sends nothing and returns `preflight_unavailable` with an `error.hint` explaining how to proceed. A timeout or lost response after submission leaves delivery uncertain; do not retry automatically.

## Actions

| Action | Purpose |
|--------|---------|
| `submit` | Send an issue report, suggestion, or usage experience through the configured WPS form channel. |

## Recommended format

When an AI client reports bugs, confusing behavior, unclear help text, rough workflows, or anything that made the interaction less smooth, write `description` like a concise GitHub Issue:

```markdown
## Summary
Short title-like summary.

## What happened
What failed, confused the agent/user, or felt rough.

## Expected behavior
What should have happened instead.

## Steps or context
Relevant tool call, action, page, parameter, or workflow context.

## Impact
Why this matters for AI agents or users.

## Suggested fix
The most direct improvement idea, if known.
```

Use `impact` for a one- or two-sentence impact summary. Use `suggestion` for the direct fix idea without repeating the full description.

## Example

```json
{
  "action": "submit",
  "description": "## Summary\nDocument creation help makes the path format easy to misread.\n\n## What happened\nWhile trying to create a child document, the agent could not quickly tell whether `path` should include the notebook name.\n\n## Expected behavior\nThe help should make the human-readable path shape obvious at the point where `path` is described.\n\n## Steps or context\nCalled document(action=\"help\", topic=\"create\") before choosing create parameters.\n\n## Impact\nAgents may choose the wrong path shape and need extra correction.\n\n## Suggested fix\nAdd one short valid create example next to the required fields.",
  "impact": "Agents may choose the wrong document path shape and need extra correction.",
  "suggestion": "Add one short valid create example next to the required fields.",
  "agent": "Claude Desktop / Claude Sonnet 4.5"
}
```

The source and plugin version fields are filled automatically.

Avoid sending secrets, API tokens, private note content, or sensitive local paths.
