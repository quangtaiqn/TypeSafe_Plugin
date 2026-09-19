# CP4-GH publication evidence

This record is limited to source publication and CI evidence. It is not live cloud, host, mobile, or OpenAI submission evidence.

- Repository: `quangtaiqn/TypeSafe_Plugin` (public), branch `main`.
- Preserved remote baseline: `b06cd590c3000d1a62264f544098aed67651d6f9`.
- Initial published merge commit: `07e89d571722b77868a13e8bcce192eef22d83c3`.
- Current published HEAD: `4dde806ca28b6ebebc36063228023cd717edcf95` (fast-forward remediation child).
- Current published tree: `b2442b4e2c72d31e7088d34978b418ecb2395214`.
- Tree read-back: 68 blobs; required plugin, service, mobile, submission, docs, test, and workflow paths are present.
- Exclusion read-back: `.env` and `node_modules` are absent from the public tree.
- CI: [run 35466116217](https://github.com/quangtaiqn/TypeSafe_Plugin/actions/runs/35466116217), conclusion `success` for the current published HEAD.
- Local evidence before publication: clean install, syntax check, 34 tests passed, tracked secret scan clean, and local plugin validator passed.

Pending: Docker build (Docker is unavailable locally), official plugin validator (local Python lacks PyYAML), live HTTPS/OAuth/provider canary, host E2E, native iOS/Android E2E, and any OpenAI submission.
