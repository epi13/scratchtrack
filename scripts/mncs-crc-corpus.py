#!/usr/bin/env python3
"""Generate mncs/crc-corpus.json: IEEE 802.3 CRC32 vectors with zlib oracle.

Single-window cases target `crc_of` (<=64 bytes); streaming cases pin
chunk-associativity through `crc_update`/`crc_finalize` with
intermediate states precomputed here (zlib accepts a running value, so
chunked updates have exact oracles too).
"""
import json
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def seq(data: bytes) -> dict:
    return {"sequence": {"values": [{"byte": {"value": b}} for b in data]}}


def intu(value: int) -> dict:
    return {"integer": {"value": value, "type": {"bits": 64, "signed": False}}}


def case(case_id: str, module_fn: str, args: list, expected: int | None) -> dict:
    module, fn = module_fn
    request = {
        "schema_version": "0.1",
        "step_budget": 4000000,
        "target": {"module": module, "function": fn},
        "arguments": args,
    }
    out = {"id": case_id, "request": request}
    if expected is not None:
        out["expected_status"] = "returned"
        out["expected"] = [intu(expected)]
    return out


CRC = "scratchtrack.crc.v1"
cases = []

vectors = [
    ("empty", b""),
    ("single-zero", b"\x00"),
    ("single-ff", b"\xff"),
    ("digits", b"123456789"),
    ("hello", b"hello"),
    ("quick-fox", b"The quick brown fox jumps over the lazy dog"),
    ("binary", bytes(range(64))),
    ("eocd-window", b"PK\x05\x06" + bytes(18)),
]
for case_id, data in vectors:
    cases.append(case("crc-" + case_id, (CRC, "crc_of"), [seq(data)], zlib.crc32(data)))

# Streaming: two chunks vs whole, with the intermediate state pinned.
chunks = [(b"12345", b"6789"), (b"The quick brown fox ", b"jumps over the lazy dog")]
for n, (first, second) in enumerate(chunks):
    # zlib exposes only finalized values; raw state = finalized ^ 0xffffffff
    # is exact for the reflected algorithm (xor-in/out are symmetric).
    running = zlib.crc32(first)
    raw_mid = running ^ 0xFFFFFFFF
    cases.append(case(f"stream{n}-update1", (CRC, "crc_update"),
                      [intu(0xFFFFFFFF), seq(first)], raw_mid))
    cases.append(case(f"stream{n}-update2", (CRC, "crc_update"),
                      [intu(raw_mid), seq(second)], zlib.crc32(second, running) ^ 0xFFFFFFFF))
    cases.append(case(f"stream{n}-final", (CRC, "crc_finalize"),
                      [intu(zlib.crc32(first + second) ^ 0xFFFFFFFF)],
                      zlib.crc32(first + second)))

cases.append(case("init", (CRC, "crc_init"), [], 0xFFFFFFFF))

out = {"schema_version": "0.1", "name": "scratchtrack-crc-kernels", "cases": cases}
dest = ROOT / "mncs" / "crc-corpus.json"
dest.write_text(json.dumps(out, indent=1) + "\n")
print(f"wrote {dest} with {len(cases)} cases")
