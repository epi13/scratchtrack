# Fabric log (append-only)

## 2026-09-06 — recon + first fabrication: text-boundary audit job

Recon (time-boxed): `mncs-fabric` CLI exposes 16 subcommands
(node, artifacts, bundle, plan, run, record, provenance, reconcile,
worker, contract, registry, enrollment, cache, ledger, fleet,
controller). No skills directory exists; "skills" in the Fabric sense
are worker capability facts (`node inspect`, `tool:<name>` attributes).

Fabrication task: `fabric/text-boundary-audit/` — a hermetic,
stdlib-only, DECLARED_OFFLINE job that re-hashes every checked-in
production WASM artifact + MNCS source bound by
`public/mncs/manifest.json` and confirms the text-corpus shape the
evidence replay depends on.

- Plan: `job-plan.json` (`scratchtrack:text-boundary-audit:0.1`,
  candidate = sha256 of the WASM manifest under audit,
  `job_identity` sha256:2f274a3c66e54d94002566d70187cfd5391a01a781fe91e31df023f2f2b26587).
  `plan validate` passes.
- Bundle: `bundle/task.py` bound by `bundle-manifest.json`
  (manifest_identity sha256:5fcf3f95...; bundle root must contain
  exactly the manifested files — `run local` rejects extras).
- `run local` → COMPLETED, exit 0, stdout
  `fabric-text-boundary-audit: PASS (23/23 checks)`, result.json
  captured (sha256:e11dfa07...). Full record preserved at
  `fabric/text-boundary-audit/execution-record.json`.
- `record verify` on the execution record → PASS
  (identity sha256:7943f78be3249e54ea77ace89512e4eb6368adce5e10b65dd4efbac97d394620).

Cross-project pressure found (not fixed here — Fabric owns it):
- Fabric `_TOOL_NAMES` (node.py) probes git/gcc/clang/make/rustc/
  cargo/podman/docker/pwsh/powershell/mncs but NOT node/npm/npx,
  even though node is a first-class MNCS boundary dependency
  (live-WASM calls, loader tests, evidence script). A ScratchTrack
  evidence-replay job therefore cannot declare `tool:node`; this job
  requires only `python` for exactly that reason.
