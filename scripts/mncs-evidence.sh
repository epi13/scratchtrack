#!/usr/bin/env bash
# Replay the MNCS evidence for the ScratchTrack MNCS modules.
#
# For each module (mncs/meter.mncs, mncs/arrange.mncs) runs: source-study
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

echo "evidence OK"
