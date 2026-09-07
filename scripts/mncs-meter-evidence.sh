#!/usr/bin/env bash
# Replay the MNCS evidence for scratchtrack.meter.v1.
#
# Runs: source-study (elaboration + obligation report), experiment runs on
# the portable-WASM and research-bytecode backends over mncs/meter-corpus.json,
# a cross-backend agreement check, and live calls into the compiled WASM
# module through node. Exits nonzero on any mismatch.
#
# Requires: cargo + the mncs-language checkout (default: ../mncs-language,
# override with MNCS_LANGUAGE_DIR) and node >= 20 for the live-WASM step.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MNCS_DIR="${MNCS_LANGUAGE_DIR:-$(cd "$ROOT/../mncs-language" && pwd)}"
MODULE="$ROOT/mncs/meter.mncs"
CORPUS="$ROOT/mncs/meter-corpus.json"
WORK="$(mktemp -d)"

echo "== source-study =="
cargo run -q -p mncs-cli --manifest-path "$MNCS_DIR/Cargo.toml" -- \
  source-study "$MODULE" --node-id scratchtrack-meter-evidence > "$WORK/study.json"
python3 - "$WORK/study.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
print("semantic_fingerprint:", d["semantic_fingerprint"])
print("unresolved_obligations:", len(d.get("unresolved_obligations", [])))
assert not d.get("diagnostics") or all(x["code"] == "CMP301" for x in d["diagnostics"]), "unexpected diagnostic codes"
print("diagnostics: all CMP301 (integer division/modulo, documented in mncs/meter.mncs)")
EOF

for backend in portable-wasm research-bytecode; do
  echo "== experiment run: $backend =="
  (cd "$MNCS_DIR" && cargo run -q -p mncs-cli -- experiment run \
    "$MODULE" --backend "$backend" --corpus "$CORPUS" \
    --output-dir "$WORK/$backend" > /dev/null)
done

echo "== cross-backend agreement =="
python3 - "$WORK" "$CORPUS" <<'EOF'
import json, sys
work, corpus_path = sys.argv[1], sys.argv[2]
runs = {}
for be in ("portable-wasm", "research-bytecode"):
    r = json.load(open(f"{work}/{be}/result.json"))
    runs[be] = {c["case_id"]: ((c.get("returned") or [{}])[0].get("integer", {}).get("value"), c.get("status")) for c in r["cases"]}
corpus = json.load(open(corpus_path))
assert len(runs["portable-wasm"]) == len(corpus["cases"]) == len(runs["research-bytecode"])
bad = [k for k in runs["portable-wasm"] if runs["portable-wasm"][k] != runs["research-bytecode"][k] or runs["portable-wasm"][k][1] != "returned"]
if bad:
    print("MISMATCH:", bad); sys.exit(1)
print(f"{len(runs['portable-wasm'])}/{len(corpus['cases'])} cases agree across backends, all returned")
EOF

echo "== live WASM calls =="
node -e '
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path + "/portable-wasm/artifact.wasm_module");
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

echo "evidence OK"
