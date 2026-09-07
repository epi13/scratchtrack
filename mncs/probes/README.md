# MNCS pressure probes (ScratchTrack → mncs-language)

Two kinds of files live here. **Expected-failure reproducers** pin an
upstream language hole that blocks concrete ScratchTrack code; each one
names the ledger item it evidences. **Regression probes** guard holes the
language has since closed — they must keep passing, and their corpora
prove it.

All commands run from the `mncs-language` checkout. Probes that import
stdlib modules need the library root exported:

```sh
export MNCS_LIBRARY_PATH=<mncs-language>/library
cargo run -q -p mncs-cli -- source-study <probe> --node-id probe-<name>
```

A refused probe emits diagnostics and **no `semantic_fingerprint`**. The
day a reproducer starts emitting a fingerprint, its ledger item is fixed
and the real ScratchTrack module it unlocks can be written for real.

## Expected-failure reproducers

| Probe | Refusal stage (observed) | Ledger | ScratchTrack code unlocked |
|---|---|---|---|
| `dsp_float_attempt.mncs` | parse: `f64` type / float literals rejected (`MNP064` etc.) | P-001 | `midiToFrequency`, compressor DSP |
| `crc32_u32_attempt.mncs` | type-check: u32 shift/XOR refused (`MNE115`, `MNE103`) | P-009 | native-speed CRC32, WAV RIFF math |
| `crc_u64_attempt.mncs` | type-check: `^` on u64 refused (`MNE115/117/119`); `>>` and `%` on u64 are fine — the gap is exactly integer XOR/AND/OR | P-009 | same as above; routed around by `mncs/crc.mncs` per-bit arithmetic |
| `subtype_attempt.mncs` | type-check: `[byte; 44]` does not coerce to `[byte; up_to 64]` (`MNE133`) | P-010 | shared `le.mncs` readers across wav/pack windows |

Refusal probes have no corpus: refusal happens before execution.
`bitwise_u64_attempt.mncs` is the exception that proves the routing:
it elaborates and executes (per-bit XOR in a counted loop with
record-carried shifting copies, after v1 showed the counted index is
not bound in the body) — it documents the workaround `mncs/crc.mncs`
is built on, not a hole.

## Regression probes (must keep passing)

| Probe | What it guards | Corpus | Ledger history |
|---|---|---|---|
| `doc_keys.mncs` + `doc_keys-corpus.json` | stdlib `json_projection.count_key` end-to-end on portable-WASM (23/23 returned) | `python3 scripts/mncs-probe-corpus.py` regenerates deterministically from `mncs/text-corpus.json` | key-scanning over bounded docs works — closed gap, probe kept as guard |
| `slice_dynamic_attempt.mncs` | dynamic `xs[start..end]` view derivation + computed indexing execute correctly on portable-WASM | `slice-corpus.json` (checked in; `head`→248, `mid`→147, both `expectation_met`) | dynamic views supported — closed gap, probe kept as guard |
| `dynidx_attempt.mncs` | dynamic index into exact sequences + trap-on-OOB | `dynidx-corpus.json` (checked in; k0/k3 `expectation_met`, oob pins `runtime_failure`) | stands under `mncs/crc.mncs` nibble table |

Run a regression probe end to end with:

```sh
cargo run -q -p mncs-cli -- experiment run mncs/probes/doc_keys.mncs \
  --backend portable-wasm --corpus mncs/probes/doc_keys-corpus.json \
  --output-dir /tmp/probe-run
cargo run -q -p mncs-cli -- experiment run mncs/probes/slice_dynamic_attempt.mncs \
  --backend portable-wasm --corpus mncs/probes/slice-corpus.json \
  --output-dir /tmp/slice-run
```
