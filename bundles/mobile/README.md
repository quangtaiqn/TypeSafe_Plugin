# Mobile-ready preparation

The mobile artifact is intentionally tool-first and backend-shared. It carries no native app, local command, PC path, browser extension, private endpoint, or credential. `MOBILE_PREPARED` means the contract, metadata, fixtures, and runbook are controlled; it does not mean iOS/Android distribution or E2E compatibility is verified.

OAuth runbook: `oauth-scenarios.json` distinguishes the locally covered expired-token denial from the live-only revoked-grant/signing-key and reconnect-after-revocation checks. A successful re-authentication must produce a fresh token before discovery/call; the client must not reuse a revoked token.
