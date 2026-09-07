#!/usr/bin/env bash
# Replay the MNCS evidence for the ScratchTrack MNCS modules.
#
# For each module (meter, arrange, migrate, geometry, wav, pack) runs: source-study
# (elaboration + obligation report), experiment runs on the portable-WASM
# and research-bytecode backends over the checked-in corpus, a
# cross-backend agreement check, and live calls into the compiled WASM
# module through node. Exits nonzero on any mismatch.
#
# Requires: cargo + the mncs-language checkout (default: ../mncs-language,
# override with MNCS_LANGUAGE_DIR) and node >= 20 for the live-WASM step.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MNCS_DIR="${MNCS_LANGUAGE_DIR:-$(cd "$ROOT/../mncs-language" && pwd)}"
WORK="$(mktemp -d)"

check_module() {
  local name="$1" module="$2" corpus="$3"
  echo "== [$name] source-study =="
  cargo run -q -p mncs-cli --manifest-path "$MNCS_DIR/Cargo.toml" -- \
    source-study "$module" --node-id "scratchtrack-$name-evidence" > "$WORK/$name-study.json"
  python3 - "$WORK/$name-study.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
print("semantic_fingerprint:", d["semantic_fingerprint"])
print("unresolved_obligations:", len(d.get("unresolved_obligations", [])))
bad = [x for x in d.get("diagnostics", []) if x.get("code") != "CMP301"]
assert not bad, f"unexpected diagnostic codes: {bad}"
print("diagnostics: all CMP301 (integer division/modulo, documented)")
EOF

  for backend in portable-wasm research-bytecode; do
    echo "== [$name] experiment run: $backend =="
    (cd "$MNCS_DIR" && cargo run -q -p mncs-cli -- experiment run \
      "$module" --backend "$backend" --corpus "$corpus" \
      --output-dir "$WORK/$name-$backend" > /dev/null)
  done

  echo "== [$name] cross-backend agreement =="
  python3 - "$WORK" "$corpus" "$name" <<'EOF'
import json, sys
work, corpus_path, name = sys.argv[1], sys.argv[2], sys.argv[3]
runs = {}
for be in ("portable-wasm", "research-bytecode"):
    r = json.load(open(f"{work}/{name}-{be}/result.json"))
    runs[be] = {c["case_id"]: ((c.get("returned") or [{}])[0].get("integer", {}).get("value",
        json.dumps(c.get("returned"))), c.get("status"), c.get("expectation_met")) for c in r["cases"]}
corpus = json.load(open(corpus_path))
assert len(runs["portable-wasm"]) == len(corpus["cases"]) == len(runs["research-bytecode"]), "case count drift"
bad = [k for k in runs["portable-wasm"] if runs["portable-wasm"][k] != runs["research-bytecode"][k]
       or runs["portable-wasm"][k][1] != "returned"]
if bad:
    print("MISMATCH:", bad); sys.exit(1)
met = sum(1 for k in runs["portable-wasm"] if runs["portable-wasm"][k][2] is True)
print(f"{len(runs['portable-wasm'])}/{len(corpus['cases'])} cases agree across backends, all returned ({met} with checked expectations)")
EOF
}

check_module "meter" "$ROOT/mncs/meter.mncs" "$ROOT/mncs/meter-corpus.json"
check_module "arrange" "$ROOT/mncs/arrange.mncs" "$ROOT/mncs/arrange-corpus.json"
check_module "migrate" "$ROOT/mncs/migrate.mncs" "$ROOT/mncs/migrate-corpus.json"
check_module "geometry" "$ROOT/mncs/geometry.mncs" "$ROOT/mncs/geometry-corpus.json"
check_module "wav" "$ROOT/mncs/wav.mncs" "$ROOT/mncs/wav-corpus.json"
check_module "pack" "$ROOT/mncs/pack.mncs" "$ROOT/mncs/pack-corpus.json"

echo "== live WASM calls: meter =="
node -e '
const fs = require("fs");
const bytes = fs.readFileSync(process.argv[1] + "/meter-portable-wasm/artifact.wasm_module");
WebAssembly.instantiate(bytes, {}).then(({ instance }) => {
  const e = instance.exports;
  const checks = [
    ["bar_ticks", [4n, 4n], 96n], ["bar_ticks", [7n, 8n], 84n], ["bar_ticks", [4n, 3n], -1n],
    ["step_ticks", [2n], 8n], ["steps_per_bar", [4n, 4n, 3n], 16n], ["steps_per_bar", [7n, 8n, 2n], -1n],
    ["quantize_tick", [79n, 6n], 78n], ["quantize_tick", [-7n, 6n], -6n],
    ["clamp_midi", [200n], 127n], ["pad_midi", [48n, 0n, 1n], 60n],
    ["pitch_class", [59n], 11n], ["octave_of", [60n], 4n],
  ];
  let pass = 0;
  for (const [name, args, exp] of checks) {
    if (e[name](...args) !== exp) { console.error("MISMATCH", name); process.exit(1); }
    pass++;
  }
  console.log(pass + "/" + checks.length + " live-WASM calls agree");
});' "$WORK"

echo "== live WASM calls: arrange =="
node -e '
const fs = require("fs");
const bytes = fs.readFileSync(process.argv[1] + "/arrange-portable-wasm/artifact.wasm_module");
WebAssembly.instantiate(bytes, {}).then(({ instance }) => {
  const e = instance.exports;
  const checks = [
    ["loop_take_allowed", [11n], 1], ["loop_take_allowed", [12n], 0],
    ["scratch_allowed", [35n], 1], ["scratch_allowed", [36n], 0],
    ["normalize_bpm", [104n], 104n], ["normalize_bpm", [19n], 104n],
    ["clip_length_ticks", [0n], 1n], ["clip_active", [5n, 96n], 1], ["clip_active", [96n, 96n], 0],
    ["move_start", [990n, 24n, 1000n], 1000n], ["resize_length", [96n, -200n, 24n, 1000n], 24n],
    ["snip_valid", [48n, 96n, 72n], 1], ["wrap_tick", [-1n, 96n], 95n],
    ["step_index", [48n, 6n], 8n], ["step_index", [50n, 6n], -1n],
    ["motif_ticks", [84n, 3n], 252n], ["loop_end_tick", [48n, 10n], 48n],
    ["max_loop_takes", [], 12n], ["max_scratches", [], 36n],
  ];
  let pass = 0;
  for (const [name, args, exp] of checks) {
    if (e[name](...args) !== exp) { console.error("MISMATCH", name); process.exit(1); }
    pass++;
  }
  console.log(pass + "/" + checks.length + " live-WASM calls agree");
});' "$WORK"

echo "== live WASM calls: migrate =="
node -e '
const fs = require("fs");
const bytes = fs.readFileSync(process.argv[1] + "/migrate-portable-wasm/artifact.wasm_module");
WebAssembly.instantiate(bytes, {}).then(({ instance }) => {
  const e = instance.exports;
  const checks = [
    ["legacy_numerator", [4n], 4n], ["legacy_numerator", [0n], -1n],
    ["remap_index", [8n, 16n, 12n], 6n], ["remap_index", [15n, 22n, 11n], 8n],
    ["remap_cell", [1n, 2n], 2n], ["content_bars", [97n, 96n], 2n],
    ["normalize_root", [-1n], 11n], ["normalize_octave", [7n], 6n],
    ["auto_scratch_upgrade", [1, 0], 0], ["auto_scratch_upgrade", [0, 0], 1],
  ];
  let pass = 0;
  for (const [name, args, exp] of checks) {
    if (e[name](...args) !== exp) { console.error("MISMATCH", name); process.exit(1); }
    pass++;
  }
  console.log(pass + "/" + checks.length + " live-WASM calls agree");
});' "$WORK"

echo "== live WASM calls: geometry =="
node -e '
const fs = require("fs");
const bytes = fs.readFileSync(process.argv[1] + "/geometry-portable-wasm/artifact.wasm_module");
WebAssembly.instantiate(bytes, {}).then(({ instance }) => {
  const e = instance.exports;
  const checks = [
    ["is_beat_step", [8n, 4n], 1], ["is_beat_step", [6n, 4n], 0],
    ["swing_applies", [0, 1n], 1], ["swing_applies", [1, 2n], 1],
    ["steps_per_beat", [16n, 4n], 4n], ["cycle_cell", [2n], 0n],
    ["advance_step", [15n, 16n], 0n], ["floor_div", [-7n, 2n], -4n],
    ["row_delta", [-14n, 26n], -1n], ["drag_started", [4n, 0n], 0],
    ["tap_cancelled", [7n, 0n], 1], ["clamp_motif_midi", [11n], 12n],
    ["shift_motif_midi", [100n, 12n], 108n], ["pick_row_midi", [72n, 99n, 25n], 48n],
    ["half_beatline_count", [96n], 8n], ["bucket_stride", [0n, 441n], 4n],
  ];
  let pass = 0;
  for (const [name, args, exp] of checks) {
    if (e[name](...args) !== exp) { console.error("MISMATCH", name); process.exit(1); }
    pass++;
  }
  console.log(pass + "/" + checks.length + " live-WASM calls agree");
});' "$WORK"

echo "== live WASM calls: wav =="
node -e '
const fs = require("fs");
const bytes = fs.readFileSync(process.argv[1] + "/wav-portable-wasm/artifact.wasm_module");
WebAssembly.instantiate(bytes, {}).then(({ instance }) => {
  const e = instance.exports;
  const checks = [
    ["wav_sample_count", [960], 480], ["wav_riff_chunk_size", [960], 996],
    ["wav_data_size_for_samples", [480], 960], ["wav_byte_rate", [44100], 88200],
    ["bits_supported", [16], 1], ["bits_supported", [8], 0],
  ];
  let pass = 0;
  for (const [name, args, exp] of checks) {
    if (e[name](...args) !== exp) { console.error("MISMATCH", name); process.exit(1); }
    pass++;
  }
  console.log(pass + "/" + checks.length + " live-WASM calls agree");
});' "$WORK"

echo "== live WASM calls: pack =="
node -e '
const fs = require("fs");
const bytes = fs.readFileSync(process.argv[1] + "/pack-portable-wasm/artifact.wasm_module");
WebAssembly.instantiate(bytes, {}).then(({ instance }) => {
  const e = instance.exports;
  const checks = [
    ["local_data_start", [0n, 12n, 0n], 42n], ["local_record_size", [12n, 100n], 142n],
    ["central_next", [284n, 12n, 0n, 0n], 342n], ["central_record_size", [12n], 58n],
    ["eocd_size", [], 22n],
  ];
  let pass = 0;
  for (const [name, args, exp] of checks) {
    if (e[name](...args) !== exp) { console.error("MISMATCH", name); process.exit(1); }
    pass++;
  }
  console.log(pass + "/" + checks.length + " live-WASM calls agree");
});' "$WORK"

echo "evidence OK"
