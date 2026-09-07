#!/usr/bin/env python3
"""Generate scratchtrack/mncs/wav-corpus.json.

Builds real 44-byte WAV headers and 12-byte magic windows. Every case
carries its expected value so the experiment harness checks
expectation_met. Byte sequences encode as canonical cells.
"""
import json
from pathlib import Path

MODULE = "scratchtrack.wav.v1"


def I(v, bits=64, signed=True):
    return {"integer": {"value": v, "type": {"bits": bits, "signed": signed}}}


def U16(v):
    return I(v, 16, False)


def U32(v):
    return I(v, 32, False)


def B(v):
    return {"byte": {"value": v}}


def seq(values):
    return {"sequence": {"values": [B(v) for v in values]}}


def wav_header(sample_rate=44100, bits=16, channels=1, fmt=1, data_size=960,
               riff=b"RIFF", wave=b"WAVE"):
    h = bytearray(44)
    h[0:4] = riff
    h[8:12] = wave
    h[20:22] = fmt.to_bytes(2, "little")
    h[22:24] = channels.to_bytes(2, "little")
    h[24:28] = sample_rate.to_bytes(4, "little")
    h[34:36] = bits.to_bytes(2, "little")
    h[40:44] = data_size.to_bytes(4, "little")
    assert len(h) == 44
    return seq(list(h))


GOOD = wav_header()
HDR48000 = wav_header(sample_rate=48000, data_size=192000)
BADBITS = wav_header(bits=8)
STEREO = wav_header(channels=2)
NOTWAV = wav_header(riff=b"RIFX")


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


def win12(values):
    assert len(values) == 12
    return seq(values)


WAV_WIN = win12([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])
WEBM_WIN = win12([0x1A, 0x45, 0xDF, 0xA3, 1, 0, 0, 0, 0, 0, 0, 0])
MP4_WIN = win12([0, 0, 0, 8, 102, 116, 121, 112, 0, 0, 0, 0])
OGG_WIN = win12([0x4F, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0])
UNK_WIN = win12([0, 0, 0, 0x18, 0x6D, 0x64, 0x61, 0x74, 0, 0, 0, 0])

CASES = [
    # Field extraction
    case("rate-44100", "wav_sample_rate", [GOOD], U32(44100)),
    case("rate-48000", "wav_sample_rate", [HDR48000], U32(48000)),
    case("bits-16", "wav_bits_per_sample", [GOOD], U16(16)),
    case("bits-8", "wav_bits_per_sample", [BADBITS], U16(8)),
    case("channels-mono", "wav_channels", [GOOD], U16(1)),
    case("channels-stereo", "wav_channels", [STEREO], U16(2)),
    case("format-pcm", "wav_format_tag", [GOOD], U16(1)),
    case("data-size", "wav_data_size", [GOOD], U32(960)),
    case("le-u16", "le_u16_at", [GOOD, I(34, 64, False)], U16(16)),
    case("le-u32", "le_u32_at", [GOOD, I(24, 64, False)], U32(44100)),
    # Validity policy
    case("magic-ok", "header_magic_ok", [GOOD],
         {"boolean": {"value": True}}),
    case("magic-bad", "header_magic_ok", [NOTWAV],
         {"boolean": {"value": False}}),
    case("decodable", "header_decodable", [GOOD],
         {"boolean": {"value": True}}),
    case("decodable-8bit", "header_decodable", [BADBITS],
         {"boolean": {"value": False}}),
    case("decodable-stereo", "header_decodable", [STEREO],
         {"boolean": {"value": False}}),
    case("decodable-notwav", "header_decodable", [NOTWAV],
         {"boolean": {"value": False}}),
    case("bits-supported", "bits_supported", [U16(16)],
         {"boolean": {"value": True}}),
    case("bits-unsupported", "bits_supported", [U16(8)],
         {"boolean": {"value": False}}),
    # Size laws
    case("sample-count", "wav_sample_count", [U32(960)], U32(480)),
    case("sample-count-odd", "wav_sample_count", [U32(961)], U32(480)),
    case("riff-size", "wav_riff_chunk_size", [U32(960)], U32(996)),
    case("data-for-samples", "wav_data_size_for_samples", [U32(480)], U32(960)),
    case("byte-rate", "wav_byte_rate", [U32(44100)], U32(88200)),
    # Magic codes
    case("magic-wav", "magic_code", [WAV_WIN], I(1)),
    case("magic-webm", "magic_code", [WEBM_WIN], I(2)),
    case("magic-mp4", "magic_code", [MP4_WIN], I(3)),
    case("magic-ogg", "magic_code", [OGG_WIN], I(4)),
    case("magic-unknown", "magic_code", [UNK_WIN], I(0)),
]

doc = {"schema_version": "0.1", "name": "scratchtrack-wav-kernels", "cases": CASES}
out = Path(__file__).resolve().parents[1] / "mncs" / "wav-corpus.json"
out.write_text(json.dumps(doc, indent=1) + "\n")
print(f"wrote {out} with {len(CASES)} cases")
