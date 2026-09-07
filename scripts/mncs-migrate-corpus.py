#!/usr/bin/env python3
"""Generate scratchtrack/mncs/migrate-corpus.json.

Every case carries its expected value so the experiment harness checks
expectation_met.
"""
import json
from pathlib import Path

MODULE = "scratchtrack.migrate.v1"


def I(v):
    return {"integer": {"value": v, "type": {"bits": 64, "signed": True}}}


def B(v):
    return {"boolean": {"value": bool(v)}}


def case(cid, fn, args, expected):
    return {
        "id": cid,
        "request": {
            "schema_version": "0.1",
            "step_budget": 256,
            "target": {"module": MODULE, "function": fn},
            "arguments": args,
        },
        "expected_status": "returned",
        "expected": [expected],
    }


CASES = [
    # Legacy meter
    case("legacy-4", "legacy_numerator", [I(4)], I(4)),
    case("legacy-3", "legacy_numerator", [I(3)], I(3)),
    case("legacy-32", "legacy_numerator", [I(32)], I(32)),
    case("legacy-1", "legacy_numerator", [I(1)], I(1)),
    case("legacy-0", "legacy_numerator", [I(0)], I(-1)),
    case("legacy-33", "legacy_numerator", [I(33)], I(-1)),
    case("legacy-neg", "legacy_numerator", [I(-2)], I(-1)),
    # Remap index: 16 -> 12 (v3 4/4 to triplet-8ths etc.)
    case("remap-start", "remap_index", [I(0), I(16), I(12)], I(0)),
    case("remap-mid", "remap_index", [I(8), I(16), I(12)], I(6)),
    case("remap-half-up", "remap_index", [I(2), I(16), I(12)], I(2)),
    case("remap-end", "remap_index", [I(15), I(16), I(12)], I(11)),
    case("remap-odd", "remap_index", [I(7), I(16), I(14)], I(6)),
    case("remap-clamp", "remap_index", [I(5), I(4), I(2)], I(1)),
    case("remap-neg", "remap_index", [I(-1), I(16), I(12)], I(0)),
    case("remap-degenerate-from", "remap_index", [I(3), I(0), I(8)], I(7)),
    case("remap-tie-rounds-up", "remap_index", [I(15), I(22), I(11)], I(8)),
    # Collision rule
    case("cell-stronger-wins", "remap_cell", [I(1), I(2)], I(2)),
    case("cell-keeps-stronger", "remap_cell", [I(2), I(1)], I(2)),
    case("cell-tie", "remap_cell", [I(1), I(1)], I(1)),
    case("cell-empty", "remap_cell", [I(0), I(0)], I(0)),
    # Content bars
    case("bars-two", "content_bars", [I(192), I(96)], I(2)),
    case("bars-exact", "content_bars", [I(84), I(84)], I(1)),
    case("bars-rounds-up", "content_bars", [I(97), I(96)], I(2)),
    case("bars-empty", "content_bars", [I(0), I(96)], I(0)),
    case("bars-degenerate-meter", "content_bars", [I(50), I(0)], I(1)),
    # Key normalization
    case("root-c", "normalize_root", [I(0)], I(0)),
    case("root-d", "normalize_root", [I(14)], I(2)),
    case("root-neg", "normalize_root", [I(-1)], I(11)),
    case("root-neg-octave", "normalize_root", [I(-13)], I(11)),
    case("root-high", "normalize_root", [I(25)], I(1)),
    case("octave-low", "normalize_octave", [I(0)], I(1)),
    case("octave-mid", "normalize_octave", [I(3)], I(3)),
    case("octave-high", "normalize_octave", [I(7)], I(6)),
    case("octave-neg", "normalize_octave", [I(-2)], I(1)),
    # Upgrade rule
    case("auto-v3-on", "auto_scratch_upgrade", [B(True), B(True)], B(True)),
    case("auto-v3-off", "auto_scratch_upgrade", [B(True), B(False)], B(False)),
    case("auto-old-off", "auto_scratch_upgrade", [B(False), B(False)], B(True)),
    case("auto-old-on", "auto_scratch_upgrade", [B(False), B(True)], B(True)),
]

doc = {"schema_version": "0.1", "name": "scratchtrack-migrate-kernels", "cases": CASES}
out = Path(__file__).resolve().parents[1] / "mncs" / "migrate-corpus.json"
out.write_text(json.dumps(doc, indent=1) + "\n")
print(f"wrote {out} with {len(CASES)} cases")
