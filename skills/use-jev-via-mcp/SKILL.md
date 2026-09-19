---
name: use-jev-via-mcp
description: Use the local system_one MCP tool for narrow, structured Jev decisions such as classification, scoring, and yes/no routing; do not use it as a chat or coding runtime.
---

# Use Jev through MCP

Use this companion skill when an AI host has the local typesafe-jev-mcp server connected and a decision is better represented as typed data than generated prose.

## When to use

Use Jev for a narrow decision the host can act on:

- choice: select one value from a closed set.
- score: place the state on an ordered rubric.
- noul: estimate the probability that a yes/no statement is true.

Do not call Jev for ordinary conversation, open-ended writing, coding, tool execution, or general reasoning. The main model remains responsible for context, planning, tool selection, approvals, and the final answer.

## One tool contract

The only MCP tool is system_one(state, questions).

- Keep state to the exact text or structured data needed for the decision.
- Put all questions that use the same state into one call.
- Give each question a stable, meaningful id.
- instructions must ask one atomic question.
- choice.criteria is a non-empty map of option ids to descriptions; score.criteria has 2–10 ordered levels; optional noul.criteria can describe true and/or false.
- Structured objects and arrays are valid descriptions. Preserve them; do not flatten them into prose.
- Never put TYPESAFE_API_KEY, endpoint, or model in tool arguments. The server owns those through its environment.

Example arguments:

    {
      "state": {"ticket": "Duplicate charge", "customer_request": "Refund the second charge"},
      "questions": {
        "department": {
          "type": "choice",
          "instructions": "Which team should handle this ticket?",
          "criteria": {
            "billing": "Payments, invoices, and refunds",
            "other": "Anything outside the listed teams"
          }
        },
        "urgency": {
          "type": "score",
          "instructions": "How urgent is the customer request?",
          "criteria": ["Routine", "Needs prompt handling", "Needs handling today"]
        },
        "refund_requested": {
          "type": "noul",
          "instructions": "Does the customer request a refund?"
        }
      }
    }

## Interpret the result

- Choice returns choice, the full probabilities map, and confidence.
- Score returns a probability-weighted score, legend, probabilities, and confidence.
- Noul returns noul from 0 to 1. It has no separate confidence; do not invent one.
- Treat probabilities and confidence as evidence, not a guarantee. Use application-owned thresholds and escalate consequential or low-confidence decisions for review.
- Keep the complete structured result available to the main model and downstream code. Do not reduce a choice or score to its label alone when the distribution matters.

## Failure and fallback

If validation, authorization, timeout, cancellation, size limit, or upstream errors occur:

1. Do not guess a Jev result and do not present an error as a decision.
2. Report the bounded error to the main model.
3. Continue with deterministic logic, ask the user, or use the main model only when that fallback is safe and approved.
4. Do not retry blindly; the server performs one request per tool call and keeps no state between calls.

The server runs locally over stdio. Its stdout is reserved for MCP JSON-RPC and diagnostic output belongs on stderr. Modern MCP 2026-07-28 and legacy 2025-11-25 wire paths are covered by this project; follow the host's negotiated protocol.

## References

- Project setup and troubleshooting: ../../README.md
- TypeSafe contract: https://docs.typesafe.ai/api
- TypeSafe primitives: https://docs.typesafe.ai/primitives
- MCP tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
