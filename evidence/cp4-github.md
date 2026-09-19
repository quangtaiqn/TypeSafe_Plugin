# CP4-GH publication evidence

This record is limited to source publication and CI evidence. It is not live cloud, host, mobile, or OpenAI submission evidence.

- Repository: `quangtaiqn/TypeSafe_Plugin` (public), branch `main`.
- Preserved remote baseline: `b06cd590c3000d1a62264f544098aed67651d6f9`.
- Published merge commit: `07e89d571722b77868a13e8bcce192eef22d83c3`.
- Published tree: `86e7c682812fb23638a5dc79c128543bccf499cd`.
- Tree read-back: 65 blobs; required plugin, service, mobile, submission, docs, test, and workflow paths are present.
- Exclusion read-back: `.env` and `node_modules` are absent from the public tree.
- CI: [run 35464684370](https://github.com/quangtaiqn/TypeSafe_Plugin/actions/runs/35464684370), conclusion `success` for the published commit.
- Local evidence before publication: clean install, syntax check, 33 tests passed, tracked secret scan clean, and local plugin validator passed.

Pending: Docker build (Docker is unavailable locally), official plugin validator (local Python lacks PyYAML), live HTTPS/OAuth/provider canary, host E2E, native iOS/Android E2E, and any OpenAI submission.
