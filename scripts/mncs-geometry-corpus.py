#!/usr/bin/env python3
"""Generate scratchtrack/mncs/geometry-corpus.json.

Every case carries its expected value so the experiment harness checks
expectation_met. Record values use the canonical name-sorted encoding.
"""
import json
from pathlib import Path

MODULE = "scratchtrack.geometry.v1"


def I(v):
    return {"integer": {"value": v, "type": {"bits": 64, "signed": True}}}


def B(v):
    return {"boolean": {"value": bool(v)}}


def bounds(s, e):
    return {"record": {
        "type_identity": "mncs:0.2:record-type:scratchtrack.geometry.v1::Bounds::end%3Ai64%3Bstart%3Ai64%3B",
        "name": "Bounds",
        "fields": [["end", I(e)], ["start", I(s)]],
    }}


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
    # Beat steps
    case("beat-on", "is_beat_step", [I(8), I(4)], B(True)),
    case("beat-off", "is_beat_step", [I(6), I(4)], B(False)),
    case("beat-zero", "is_beat_step", [I(0), I(4)], B(True)),
    case("beat-degenerate", "is_beat_step", [I(3), I(0)], B(False)),
    # Swing phase
    case("swing-binary", "swing_applies", [B(False), I(1)], B(True)),
    case("swing-binary-off", "swing_applies", [B(False), I(2)], B(False)),
    case("swing-triplet", "swing_applies", [B(True), I(2)], B(True)),
    case("swing-triplet-off", "swing_applies", [B(True), I(1)], B(False)),
    # Steps per beat
    case("spb-16-4", "steps_per_beat", [I(16), I(4)], I(4)),
    case("spb-14-7", "steps_per_beat", [I(14), I(7)], I(2)),
    case("spb-round", "steps_per_beat", [I(12), I(5)], I(2)),
    case("spb-min", "steps_per_beat", [I(0), I(4)], I(1)),
    # Cell cycle / advance
    case("cycle-0", "cycle_cell", [I(0)], I(1)),
    case("cycle-1", "cycle_cell", [I(1)], I(2)),
    case("cycle-2", "cycle_cell", [I(2)], I(0)),
    case("advance", "advance_step", [I(15), I(16)], I(0)),
    case("advance-mid", "advance_step", [I(3), I(16)], I(4)),
    case("advance-degenerate", "advance_step", [I(3), I(0)], I(0)),
    # Floor division
    case("fdiv-pos", "floor_div", [I(7), I(2)], I(3)),
    case("fdiv-neg", "floor_div", [I(-7), I(2)], I(-4)),
    case("fdiv-neg-small", "floor_div", [I(-1), I(52)], I(-1)),
    case("fdiv-exact-neg", "floor_div", [I(-52), I(52)], I(-1)),
    case("fdiv-zero", "floor_div", [I(0), I(52)], I(0)),
    # Row delta (ROW_H = 26)
    case("row-still", "row_delta", [I(0), I(26)], I(0)),
    case("row-half-down", "row_delta", [I(12), I(26)], I(0)),
    case("row-half-up", "row_delta", [I(13), I(26)], I(1)),
    case("row-neg-half", "row_delta", [I(-13), I(26)], I(0)),
    case("row-neg", "row_delta", [I(-14), I(26)], I(-1)),
    case("row-neg-up", "row_delta", [I(-39), I(26)], I(-1)),
    # Drag / tap thresholds
    case("drag-dx", "drag_started", [I(5), I(0)], B(True)),
    case("drag-dy", "drag_started", [I(0), I(1)], B(True)),
    case("drag-neg", "drag_started", [I(-5), I(0)], B(True)),
    case("drag-still", "drag_started", [I(4), I(0)], B(False)),
    case("tap-moved", "tap_cancelled", [I(7), I(0)], B(True)),
    case("tap-neg", "tap_cancelled", [I(0), I(-7)], B(True)),
    case("tap-still", "tap_cancelled", [I(6), I(6)], B(False)),
    # Motif MIDI
    case("midi-low", "clamp_motif_midi", [I(11)], I(12)),
    case("midi-high", "clamp_motif_midi", [I(109)], I(108)),
    case("midi-ok", "clamp_motif_midi", [I(60)], I(60)),
    case("shift-up", "shift_motif_midi", [I(60), I(12)], I(72)),
    case("shift-clamped", "shift_motif_midi", [I(100), I(12)], I(108)),
    case("shift-down", "shift_motif_midi", [I(60), I(-12)], I(48)),
    case("row-midi", "pick_row_midi", [I(72), I(0), I(25)], I(72)),
    case("row-midi-low", "pick_row_midi", [I(72), I(24), I(25)], I(48)),
    case("row-midi-clamped", "pick_row_midi", [I(72), I(99), I(25)], I(48)),
    # Beatlines
    case("beatlines-4-4", "half_beatline_count", [I(96)], I(8)),
    case("beatlines-7-8", "half_beatline_count", [I(84)], I(7)),
    case("beatlines-empty", "half_beatline_count", [I(0)], I(0)),
    # Waveform buckets (length 1000, count 120: size 8)
    case("bucket-first", "bucket_bounds", [I(1000), I(0), I(120)], bounds(0, 8)),
    case("bucket-mid", "bucket_bounds", [I(1000), I(5), I(120)], bounds(40, 48)),
    case("bucket-stride", "bucket_stride", [I(40), I(48)], I(1)),
    case("bucket-stride-wide", "bucket_stride", [I(0), I(441)], I(4)),
]

doc = {"schema_version": "0.1", "name": "scratchtrack-geometry-kernels", "cases": CASES}
out = Path(__file__).resolve().parents[1] / "mncs" / "geometry-corpus.json"
out.write_text(json.dumps(doc, indent=1) + "\n")
print(f"wrote {out} with {len(CASES)} cases")
