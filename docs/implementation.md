# Implementation tracking

This record keeps the plan and implementation evidence in lockstep.

| Checkpoint | Status | Evidence | Pending boundary |
|---|---|---|---|
| CP0 | `COMPLETE_OFFLINE` | Surface matrix in `compatibility-decision.md`. | Host/account capabilities still require separate live checks. |
| R0 | `COMPLETE` | Normalized source baseline `R0-20260920-source`, `R0-recovery-ready`, hash validation, isolated restore, allowlist and secret-content exclusion. | Local recovery data is intentionally ignored by Git. |
| CP1 | `COMPLETE_LOCAL` | Source allowlist, MIT/license inventory, clean dependency metadata, core tests. | External ownership/legal confirmation is not inferred. |
| CP2 | `COMPLETE_LOCAL` | HTTP handler, MCP SDK v2, auth/quota/size/cancel paths and tests. | No public HTTPS deployment or container smoke yet. |
| CP3 | `COMPLETE_LOCAL` | JWT/JWKS negative tests, deny-by-default configuration, redacted logging and quota. | Provider/domain/secret-manager integration pending. |
| CP4 | `COMPLETE_LOCAL` | Plugin scaffold/manifest, skill, MCP template, validator. | Template endpoint intentionally non-routable until deployment. |
| CP4-GH | `COMPLETE_PUBLISHED` | `evidence/cp4-github.md`, commit/tree read-back, 65-blob tree, and successful GitHub Actions run. | No live HTTPS/OAuth/provider canary or host E2E. |
| CP5–CP8 | `BLOCKED_BY_EXTERNAL_INPUT` | No cloud resources or provider canary supplied. | Need authorized HTTPS/OAuth/provider canary and host E2E. |
| CP9 | `MOBILE_PREPARED` | Shared skill/metadata, mobile matrix and runbook included. | Native mobile access/distribution not verified. |
| CP10a | `SUBMISSION_READY_DRAFT` | Draft profile and test cases included. | Quang must confirm publisher/brand/privacy/terms and submit manually if desired. |
| CP10b/CP10c/CP11 | `NOT_STARTED` | No submission ID or native evidence. | Never claim submitted, approved, published, or mobile-ready. |

The implementation deviation from the plan is deliberate: no cloud resource, paid service, fake app ID, or live credential was invented to make a later checkpoint appear complete.
