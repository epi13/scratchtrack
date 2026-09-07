#!/usr/bin/env python3
"""Generate scratchtrack/mncs/pack-corpus.json.

Hand-built local/central/EOCD windows with real ZIP-store layout values.
Every case carries its expected value so the experiment harness checks
expectation_met. Records use the canonical name-sorted encoding.
"""
import json
from pathlib import Path

MODULE = "scratchtrack.pack.v1"


def I(v, bits=64, signed=True):
    return {"integer": {"value": v, "type": {"bits": bits, "signed": signed}}}


def U16(v):
    return I(v, 16, False)


def U32(v):
    return I(v, 32, False)


def U64(v):
    return I(v, 64, False)


def B(v):
    return {"byte": {"value": v}}


def seq46(values):
    assert len(values) == 46, len(values)
    return {"sequence": {"values": [B(v) for v in values]}}


def seq22(values):
    assert len(values) == 22, len(values)
    return {"sequence": {"values": [B(v) for v in values]}}


def entry(name_len, extra_len, comment_len, local_offset, data_size, crc):
    return {"record": {
        "type_identity": "mncs:0.2:record-type:scratchtrack.pack.v1::Entry::comment_len%3Au64%3Bcrc%3Au32%3Bdata_size%3Au64%3Bextra_len%3Au64%3Blocal_offset%3Au64%3Bname_len%3Au64%3B",
        "name": "Entry",
        "fields": [
            ["comment_len", U64(comment_len)],
            ["crc", U32(crc)],
            ["data_size", U64(data_size)],
            ["extra_len", U64(extra_len)],
            ["local_offset", U64(local_offset)],
            ["name_len", U64(name_len)],
        ],
    }}


def le16(v):
    return [v & 0xFF, (v >> 8) & 0xFF]


def le32(v):
    return [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]


# Local header: sig PK\x03\x04, sizes, name_len 12 ("project.json"), data 100.
LOCAL = ([0x50, 0x4B, 0x03, 0x04] + [20, 0, 0, 0, 0, 0, 0, 0, 0, 0]
         + le32(0x12345678) + le32(100) + le32(100) + le16(12) + le16(0)
         + [0] * 16)
assert len(LOCAL) == 46

# Central entry: sig PK\x01\x02, crc, sizes, name 12, local offset 0.
CENTRAL = ([0x50, 0x4B, 0x01, 0x02] + [20, 0, 20, 0] + [0] * 8
           + le32(0x12345678) + le32(100) + le32(100) + le16(12)
           + le16(0) + le16(0) + [0] * 8 + le32(0))
assert len(CENTRAL) == 46, len(CENTRAL)

# EOCD: sig PK\x05\x06, count 2, central size 116, central offset 284.
EOCD = ([0x50, 0x4B, 0x05, 0x06] + [0, 0, 0, 0] + le16(2) + le16(2)
        + le32(116) + le32(284) + le16(0))
assert len(EOCD) == 22, len(EOCD)

BADSIG = [0] * 46


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


def boolean(v):
    return {"boolean": {"value": bool(v)}}


CASES = [
    # Local header
    case("local-sig", "local_signature_ok", [seq46(LOCAL)], boolean(True)),
    case("local-sig-bad", "local_signature_ok", [seq46(BADSIG)], boolean(False)),
    case("local-name", "local_name_len", [seq46(LOCAL)], U16(12)),
    case("local-extra", "local_extra_len", [seq46(LOCAL)], U16(0)),
    case("local-size", "local_data_size", [seq46(LOCAL)], U32(100)),
    case("local-start", "local_data_start", [U64(0), U64(12), U64(0)], U64(42)),
    case("local-start-extra", "local_data_start", [U64(100), U64(5), U64(7)], U64(142)),
    case("local-record", "local_record_size", [U64(12), U64(100)], U64(142)),
    # Central entry
    case("central-sig", "central_signature_ok", [seq46(CENTRAL)], boolean(True)),
    case("central-sig-bad", "central_signature_ok", [seq46(BADSIG)], boolean(False)),
    case("central-entry", "central_entry", [seq46(CENTRAL)],
         entry(12, 0, 0, 0, 100, 0x12345678)),
    case("central-next", "central_next", [U64(284), U64(12), U64(0), U64(0)], U64(342)),
    case("central-next-runs", "central_next", [U64(0), U64(12), U64(4), U64(6)], U64(68)),
    case("central-record", "central_record_size", [U64(12)], U64(58)),
    # EOCD
    case("eocd-sig", "eocd_signature_ok", [seq22(EOCD)], boolean(True)),
    case("eocd-sig-bad", "eocd_signature_ok", [seq22([0] * 22)], boolean(False)),
    case("eocd-count", "eocd_count", [seq22(EOCD)], U16(2)),
    case("eocd-size", "eocd_central_size", [seq22(EOCD)], U32(116)),
    case("eocd-offset", "eocd_central_offset", [seq22(EOCD)], U32(284)),
    case("eocd-fixed", "eocd_size", [], U64(22)),
    # Readers
    case("le16", "le16_46", [seq46(LOCAL), I(26, 64, False)], U16(12)),
    case("le32", "le32_46", [seq46(LOCAL), I(22, 64, False)], U32(100)),
    case("le16-eocd", "le16_22", [seq22(EOCD), I(10, 64, False)], U16(2)),
    case("le32-eocd", "le32_22", [seq22(EOCD), I(12, 64, False)], U32(116)),
]

doc = {"schema_version": "0.1", "name": "scratchtrack-pack-kernels", "cases": CASES}
out = Path(__file__).resolve().parents[1] / "mncs" / "pack-corpus.json"
out.write_text(json.dumps(doc, indent=1) + "\n")
print(f"wrote {out} with {len(CASES)} cases")
