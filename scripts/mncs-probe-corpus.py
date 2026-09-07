#!/usr/bin/env python3
"""Build the corpus for the mncs/probes/doc_keys.mncs pressure probe.

Deterministic: packs each case of mncs/text-corpus.json's canonical
request JSON (UTF-8, truncated to the probe's 64-byte document bound)
as the single `document` argument of `version_key_hits`. Argument
encoding mirrors mncs/text-corpus.json exactly
(`sequence.values[].byte.value`).

Regenerate: python3 scripts/mncs-probe-corpus.py
Run: MNCS_LIBRARY_PATH=<mncs-language>/library \
       cargo run -q -p mncs-cli -- experiment run mncs/probes/doc_keys.mncs \
       --backend portable-wasm --corpus mncs/probes/doc_keys-corpus.json \
       --output-dir /tmp/probe-run
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC_LEN = 64

text_corpus = json.loads((ROOT / "mncs" / "text-corpus.json").read_text())
text_cases = text_corpus["cases"]
assert len(text_cases) == 23, f"expected 23 text cases, got {len(text_cases)}"

cases = []
for case in text_cases:
    blob = json.dumps(case["request"], sort_keys=True).encode("utf-8")[:DOC_LEN]
    cases.append({
        "id": case["id"],
        "request": {
            "schema_version": "0.1",
            "step_budget": 4096,
            "target": {
                "module": "scratchtrack.probes.doc_keys",
                "function": "version_key_hits",
            },
            "arguments": [
                {"sequence": {"values": [{"byte": {"value": b}} for b in blob]}},
            ],
        },
    })

out = {"schema_version": "0.1", "name": "scratchtrack-doc-keys-probe", "cases": cases}
dest = ROOT / "mncs" / "probes" / "doc_keys-corpus.json"
dest.write_text(json.dumps(out, indent=1) + "\n")
print(f"wrote {dest} with {len(cases)} cases")
