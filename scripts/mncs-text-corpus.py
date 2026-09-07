#!/usr/bin/env python3
"""Generate scratchtrack/mncs/text-corpus.json.

Position strings as byte views. Every case carries its expected value so
the experiment harness checks expectation_met. Position records use the
canonical name-sorted encoding.
"""
import json
from pathlib import Path

MODULE = "scratchtrack.text.v1"


def U64(v):
    return {"integer": {"value": v, "type": {"bits": 64, "signed": False}}}


def B(v):
    return {"boolean": {"value": bool(v)}}


def view(text):
    raw = text.encode("ascii")
    assert len(raw) <= 64, text
    return {"sequence": {"values": [{"byte": {"value": b}} for b in raw]}}


def position(bar, beat, sixth, valid):
    return {"record": {
        "type_identity": "mncs:0.2:record-type:scratchtrack.text.v1::Position::bar%3Au64%3Bbeat%3Au64%3Bsixth%3Au64%3Bvalid%3Abool%3B",
        "name": "Position",
        "fields": [
            ["bar", U64(bar)],
            ["beat", U64(beat)],
            ["sixth", U64(sixth)],
            ["valid", B(valid)],
        ],
    }}


def case(cid, fn, args, expected):
    return {
        "id": cid,
        "request": {
            "schema_version": "0.1",
            "step_budget": 4096,
            "target": {"module": MODULE, "function": fn},
            "arguments": args,
        },
        "expected_status": "returned",
        "expected": [expected],
    }


CASES = [
    case("full", "parse_position", [view("7.3.2")], position(7, 3, 2, True)),
    case("bar-only", "parse_position", [view("7")], position(7, 1, 0, True)),
    case("bar-beat", "parse_position", [view("11.8")], position(11, 8, 0, True)),
    case("empty", "parse_position", [view("")], position(0, 1, 0, True)),
    case("empty-middle", "parse_position", [view("7..2")], position(7, 0, 2, True)),
    case("zeros", "parse_position", [view("1.1.0")], position(1, 1, 0, True)),
    case("leading-zeros", "parse_position", [view("04.02.01")], position(4, 2, 1, True)),
    case("letter", "parse_position", [view("a")], position(0, 0, 0, False)),
    case("letter-tail", "parse_position", [view("7.3x")], position(0, 0, 0, False)),
    case("four-parts", "parse_position", [view("1.2.3.4")], position(0, 0, 0, False)),
    case("space", "parse_position", [view("7 ")], position(0, 0, 0, False)),
    case("negative", "parse_position", [view("-1")], position(0, 0, 0, False)),
    case("is-digit-7", "is_digit", [{"byte": {"value": 55}}], B(True)),
    case("is-digit-dot", "is_digit", [{"byte": {"value": 46}}], B(False)),
    case("ticks-7-3-2", "position_ticks", [U64(7), U64(3), U64(2), U64(96)],
         {"integer": {"value": 636, "type": {"bits": 64, "signed": True}}}),
    case("ticks-origin", "position_ticks", [U64(1), U64(1), U64(0), U64(96)],
         {"integer": {"value": 0, "type": {"bits": 64, "signed": True}}}),
    case("ticks-5-3", "position_ticks", [U64(5), U64(3), U64(0), U64(96)],
         {"integer": {"value": 432, "type": {"bits": 64, "signed": True}}}),
    case("ticks-odd-meter", "position_ticks", [U64(2), U64(1), U64(0), U64(84)],
         {"integer": {"value": 84, "type": {"bits": 64, "signed": True}}}),
    case("ticks-sixteenth", "position_ticks", [U64(1), U64(2), U64(3), U64(96)],
         {"integer": {"value": 42, "type": {"bits": 64, "signed": True}}}),
    case("ticks-bar-floor", "position_ticks", [U64(0), U64(0), U64(9), U64(96)],
         {"integer": {"value": 18, "type": {"bits": 64, "signed": True}}}),
    case("ticks-beat-range", "position_ticks", [U64(2), U64(99), U64(0), U64(96)],
         {"integer": {"value": -1, "type": {"bits": 64, "signed": True}}}),
    case("ticks-total-range", "position_ticks", [U64(999), U64(1), U64(0), U64(96)],
         {"integer": {"value": -1, "type": {"bits": 64, "signed": True}}}),
    case("ticks-cap", "position_ticks", [U64(17), U64(1), U64(0), U64(96)],
         {"integer": {"value": 1536, "type": {"bits": 64, "signed": True}}}),
]

doc = {"schema_version": "0.1", "name": "scratchtrack-text-kernels", "cases": CASES}
out = Path(__file__).resolve().parents[1] / "mncs" / "text-corpus.json"
out.write_text(json.dumps(doc, indent=1) + "\n")
print(f"wrote {out} with {len(CASES)} cases")
