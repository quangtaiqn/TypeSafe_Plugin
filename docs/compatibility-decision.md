# Compatibility decision

Status date: 2026-09-20. This is an evidence boundary, not a product compatibility promise.

| Surface | Current status | Evidence/next gate |
|---|---|---|
| Codex Desktop/CLI | `PREPARED_LOCAL` | Plugin manifest, skill, and HTTPS MCP template validate locally; clean-host install and live cloud call are not run. |
| ChatGPT desktop Chat/Work | `UNKNOWN` | Requires a separate host/version test with the supported plugin/app connection. |
| ChatGPT Web/Work | `WAITING_FOR_ACCOUNT_ACCESS` | Needs a real cloud app/connection ID and supported skill binding; no fake `.app.json` is included. |
| Codex Web/cloud | `UNKNOWN` | Must be verified through the official mechanism of that runtime. |
| iOS/Android | `MOBILE_PREPARED` | Shared cloud metadata and mobile runbook are present; native E2E is not run. |

The implementation deliberately does not treat local stdio, Inspector, mock provider responses, or repository upload as live host/cloud evidence. No remote tunnel, SSH path, private desktop fallback, or PWA is used.
