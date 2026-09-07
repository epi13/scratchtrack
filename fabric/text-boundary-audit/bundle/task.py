#!/usr/bin/env python3
"""Fabric-bounded audit of the ScratchTrack MNCS text pressure boundary.

Runs under `mncs-fabric run local` (DECLARED_OFFLINE, stdlib only): it
re-hashes every checked-in production WASM artifact and MNCS source the
`public/mncs/manifest.json` binds, confirms the text corpus shape the
evidence replay depends on, and writes `result.json` (a Fabric
`result_paths` entry) plus a one-line verdict on stdout.

The repo root under audit arrives via SCRATCHTRACK_ROOT (plan
environment); every audited byte is re-hashed here, so the Fabric
execution record binds the outcome even though the data lives outside
the job bundle manifest (which binds this task code instead).
"""
import hashlib
import json
import os
import sys
from pathlib import Path

WASM_MAGIC = b"\x00asm"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    root = Path(os.environ["SCRATCHTRACK_ROOT"])
    checks = []

    def record(check_id: str, ok: bool, detail: str) -> None:
        checks.append({"id": check_id, "ok": ok, "detail": detail})

    manifest_path = root / "public" / "mncs" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    record("manifest-readable", True, f"{len(manifest['artifacts'])} artifact entries")
    for entry in manifest["artifacts"]:
        source = root / entry["source"]
        artifact = root / entry["artifact"]
        record(f"source-hash:{entry['source']}",
               sha256(source) == entry["source_sha256"], entry["source_sha256"][:16])
        raw = artifact.read_bytes()
        record(f"artifact-hash:{entry['artifact']}",
               sha256(artifact) == entry["artifact_sha256"]
               and len(raw) == entry["artifact_bytes"], entry["artifact_sha256"][:16])
        record(f"artifact-magic:{entry['artifact']}",
               raw[:4] == WASM_MAGIC, "wasm-magic" if raw[:4] == WASM_MAGIC else "bad-magic")

    corpus = json.loads((root / "mncs" / "text-corpus.json").read_text())
    cases = corpus["cases"]
    with_expectations = [c for c in cases
                         if c.get("expected_status") == "returned" and c.get("expected")]
    record("text-corpus-shape", len(cases) == 23 and len(with_expectations) == 23,
           f"{len(with_expectations)}/{len(cases)} cases carry checked expectations")

    verdict = "PASS" if all(c["ok"] for c in checks) else "FAIL"
    Path("result.json").write_text(json.dumps(
        {"schema_version": "scratchtrack.fabric-audit-result/1",
         "verdict": verdict, "checks": checks}, indent=1) + "\n")
    print(f"fabric-text-boundary-audit: {verdict} "
          f"({sum(1 for c in checks if c['ok'])}/{len(checks)} checks)")
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
