---
name: typesafe-ai
description: Use the TypeSafe Jev system_one MCP tool for narrow typed Choice, Noul, and Score judgments; keep context, thresholds, approvals, and final actions with the main model.
---

# TypeSafe AI

Use `system_one(state, questions)` when a decision is naturally represented as typed data instead of prose. The connected server may be local for development or HTTPS cloud for a deployed plugin.

## Use it for

- `choice`: select one value from a closed set.
- `score`: place the state on an ordered rubric.
- `noul`: estimate the probability that a yes/no statement is true.

Do not call it for ordinary conversation, open-ended writing, coding, tool execution, or general reasoning. The main model owns context, tool selection, thresholds, approvals, and the final answer.

## Contract rules

- Keep `state` limited to the evidence needed for the decision.
- Batch questions that use the same state into one call; give every question a stable id.
- Ask one atomic question per item.
- `choice.criteria` is a non-empty map; `score.criteria` has 2–10 ordered levels; `noul.criteria` may describe true and/or false.
- Structured objects and arrays are valid descriptions; preserve them instead of flattening them into prose.
- Never put an API key, OAuth token, endpoint, or model in tool arguments. The server owns provider configuration.
- Do not repeat a call with unchanged evidence to seek a preferred result.

## Interpret results

- Choice returns the selected option, its complete probabilities map, and confidence.
- Score returns a probability-weighted score, legend, probabilities, and confidence.
- Noul returns `noul` from 0 to 1 and has no separate confidence; never invent one.
- Treat probabilities and confidence as evidence, not guarantees. Keep application thresholds separate from model probability.
- Escalate consequential or low-confidence outcomes for review rather than silently acting.

## Failure and fallback

If validation, authorization, timeout, cancellation, size limit, quota, or upstream errors occur:

1. Do not guess a Jev result or present an error as a decision.
2. Report the bounded error to the main model.
3. Use deterministic logic, ask the user, or use the main model only when the fallback is safe and approved.
4. Do not retry blindly; each tool call is one bounded request and the service may reject repeats.

The service must keep credentials server-side, redact authorization data from logs, and return structured errors. Tool success or Inspector output is not live provider or host compatibility proof.

## Example shape

```json
{
  "state": {"ticket": "Duplicate charge", "customer_request": "Refund the second charge"},
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this ticket?",
      "criteria": {"billing": "Payments and refunds", "other": "Outside the listed teams"}
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is the request?",
      "criteria": ["Routine", "Needs prompt handling", "Needs handling today"]
    },
    "refund_requested": {
      "type": "noul",
      "instructions": "Does the customer request a refund?"
    }
  }
}
```
