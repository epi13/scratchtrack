#!/usr/bin/env python3
"""Generate scratchtrack/mncs/arrange-corpus.json.

Record values use the canonical encoding the toolchain returns: fields
sorted by name, with the matching type_identity. Every case carries its
expected value so the experiment harness checks expectation_met.
"""
import json
from pathlib import Path

MODULE = "scratchtrack.arrange.v1"


def I(v):
    return {"integer": {"value": v, "type": {"bits": 64, "signed": True}}}


def B(v):
    return {"boolean": {"value": bool(v)}}


def clip(s, l, o):
    return {"record": {
        "type_identity": "mncs:0.2:record-type:scratchtrack.arrange.v1::Clip::length%3Ai64%3Boffset%3Ai64%3Bstart%3Ai64%3B",
        "name": "Clip",
        "fields": [["length", I(l)], ["offset", I(o)], ["start", I(s)]],
    }}


def loop(s, e):
    return {"record": {
        "type_identity": "mncs:0.2:record-type:scratchtrack.arrange.v1::Loop::end%3Ai64%3Bstart%3Ai64%3B",
        "name": "Loop",
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
    # Session policy
    case("max-loop-takes", "max_loop_takes", [], I(12)),
    case("take-allowed-0", "loop_take_allowed", [I(0)], B(True)),
    case("take-allowed-11", "loop_take_allowed", [I(11)], B(True)),
    case("take-blocked-12", "loop_take_allowed", [I(12)], B(False)),
    case("max-scratches", "max_scratches", [], I(36)),
    case("scratch-allowed-35", "scratch_allowed", [I(35)], B(True)),
    case("scratch-blocked-36", "scratch_allowed", [I(36)], B(False)),
    # Project header
    case("bpm-ok", "normalize_bpm", [I(104)], I(104)),
    case("bpm-low", "normalize_bpm", [I(20)], I(20)),
    case("bpm-high", "normalize_bpm", [I(300)], I(300)),
    case("bpm-under", "normalize_bpm", [I(19)], I(104)),
    case("bpm-over", "normalize_bpm", [I(301)], I(104)),
    # Clip kernels
    case("sanitize-clean", "sanitize_clip", [I(48), I(96), I(0), I(24)], clip(48, 96, 0)),
    case("sanitize-neg-start", "sanitize_clip", [I(-5), I(96), I(12), I(24)], clip(0, 96, 12)),
    case("sanitize-zero-len", "sanitize_clip", [I(48), I(0), I(12), I(24)], clip(48, 24, 12)),
    case("sanitize-neg-len", "sanitize_clip", [I(48), I(-3), I(0), I(24)], clip(48, 24, 0)),
    case("clip-end", "clip_end", [clip(48, 96, 12)], I(144)),
    case("active-inside", "clip_active", [I(5), I(96)], B(True)),
    case("active-zero", "clip_active", [I(0), I(96)], B(True)),
    case("active-end", "clip_active", [I(96), I(96)], B(False)),
    case("active-neg", "clip_active", [I(-1), I(96)], B(False)),
    case("cliplen", "clip_length_ticks", [I(96)], I(96)),
    case("cliplen-zero", "clip_length_ticks", [I(0)], I(1)),
    case("cliplen-neg", "clip_length_ticks", [I(-5)], I(1)),
    case("move", "move_start", [I(100), I(24), I(1000)], I(124)),
    case("move-floor", "move_start", [I(100), I(-200), I(1000)], I(0)),
    case("move-ceil", "move_start", [I(990), I(24), I(1000)], I(1000)),
    case("resize", "resize_length", [I(96), I(24), I(24), I(1000)], I(120)),
    case("resize-floor", "resize_length", [I(96), I(-200), I(24), I(1000)], I(24)),
    case("resize-ceil", "resize_length", [I(990), I(48), I(24), I(1000)], I(1000)),
    case("snip-valid", "snip_valid", [I(48), I(96), I(72)], B(True)),
    case("snip-at-start", "snip_valid", [I(48), I(96), I(48)], B(False)),
    case("snip-at-end", "snip_valid", [I(48), I(96), I(144)], B(False)),
    case("snip-left", "snip_left", [I(48), I(96), I(12), I(72)], clip(48, 24, 12)),
    case("snip-right", "snip_right", [I(48), I(96), I(12), I(72)], clip(72, 72, 36)),
    # Position kernels
    case("wrap", "wrap_tick", [I(100), I(96)], I(4)),
    case("wrap-neg", "wrap_tick", [I(-1), I(96)], I(95)),
    case("wrap-exact", "wrap_tick", [I(96), I(96)], I(0)),
    case("wrap-degenerate", "wrap_tick", [I(5), I(0)], I(5)),
    case("stepidx", "step_index", [I(48), I(6)], I(8)),
    case("stepidx-zero", "step_index", [I(0), I(6)], I(0)),
    case("stepidx-off", "step_index", [I(50), I(6)], I(-1)),
    case("stepidx-degenerate", "step_index", [I(48), I(0)], I(-1)),
    # Motif kernels
    case("motifbars-low", "clamp_motif_bars", [I(0)], I(1)),
    case("motifbars-mid", "clamp_motif_bars", [I(3)], I(3)),
    case("motifbars-high", "clamp_motif_bars", [I(9)], I(8)),
    case("motif-ticks", "motif_ticks", [I(96), I(2)], I(192)),
    case("motif-ticks-odd", "motif_ticks", [I(84), I(3)], I(252)),
    case("motif-ticks-zero", "motif_ticks", [I(96), I(0)], I(1)),
    # Loop kernels
    case("loopstart-neg", "loop_start_tick", [I(-5)], I(0)),
    case("loopstart-ok", "loop_start_tick", [I(48)], I(48)),
    case("loopend", "loop_end_tick", [I(48), I(200)], I(200)),
    case("loopend-floor", "loop_end_tick", [I(48), I(10)], I(48)),
]

doc = {"schema_version": "0.1", "name": "scratchtrack-arrange-kernels", "cases": CASES}
out = Path(__file__).resolve().parents[1] / "mncs" / "arrange-corpus.json"
out.write_text(json.dumps(doc, indent=1) + "\n")
print(f"wrote {out} with {len(CASES)} cases")
