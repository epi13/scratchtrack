#!/usr/bin/env bash
# Build production browser WASM artifacts from the checked-in MNCS sources.
#
# For each product module (mncs/*.mncs) runs the portable-WASM backend over
# a single-case build corpus and writes public/mncs/<name>.wasm plus a
# manifest binding every artifact to its source SHA-256 and the compiler
# revision. Builds are byte-deterministic (verified); CI rebuilds and
# fails on any byte mismatch so no stale artifact can ship.
#
# Requires: cargo + the mncs-language checkout (default: ../mncs-language,
# override with MNCS_LANGUAGE_DIR) and python3 for corpus generation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MNCS_DIR="${MNCS_LANGUAGE_DIR:-$(cd "$ROOT/../mncs-language" && pwd)}"
OUT="${MNCS_WASM_OUT:-$ROOT/public/mncs}"
WORK="$(mktemp -d)"
mkdir -p "$OUT"

# name|mncs-module|function|json-arguments
MODULES=(
  "meter|scratchtrack.meter.v1|ticks_per_beat|[]"
  "arrange|scratchtrack.arrange.v1|max_loop_takes|[]"
  "migrate|scratchtrack.migrate.v1|legacy_numerator|[{\"integer\":{\"value\":4,\"type\":{\"bits\":64,\"signed\":true}}}]"
  "geometry|scratchtrack.geometry.v1|half_beatline_count|[{\"integer\":{\"value\":96,\"type\":{\"bits\":64,\"signed\":true}}}]"
  "wav|scratchtrack.wav.v1|wav_sample_count|[{\"integer\":{\"value\":960,\"type\":{\"bits\":32,\"signed\":false}}}]"
  "pack|scratchtrack.pack.v1|eocd_size|[]"
  "text|scratchtrack.text.v1|is_digit|[{\"byte\":{\"value\":55}}]"
  "crc|scratchtrack.crc.v1|crc_of|[{\"sequence\":{\"values\":[{\"byte\":{\"value\":49}},{\"byte\":{\"value\":50}},{\"byte\":{\"value\":51}}]}}]"
)

COMPILER_REV="$(git -C "$MNCS_DIR" rev-parse HEAD)"
MANIFEST_ENTRIES=""

for spec in "${MODULES[@]}"; do
  IFS='|' read -r name module func args <<< "$spec"
  src="$ROOT/mncs/$name.mncs"
  python3 - "$WORK/$name-build-corpus.json" "$module" "$func" "$args" <<'EOF'
import json, sys
out, module, func, args = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
json.dump({"schema_version": "0.1", "name": "build", "cases": [
  {"id": "build", "request": {"schema_version": "0.1", "step_budget": 256,
   "target": {"module": module, "function": func}, "arguments": args}}]}, open(out, "w"))
EOF
  (cd "$MNCS_DIR" && cargo run -q -p mncs-cli -- experiment run \
    "$src" --backend portable-wasm --corpus "$WORK/$name-build-corpus.json" \
    --output-dir "$WORK/$name" > /dev/null)
  cp "$WORK/$name/artifact.wasm_module" "$OUT/$name.wasm"
  source_sha="$(sha256sum "$src" | cut -d' ' -f1)"
  artifact_sha="$(sha256sum "$OUT/$name.wasm" | cut -d' ' -f1)"
  artifact_bytes="$(stat -c%s "$OUT/$name.wasm")"
  MANIFEST_ENTRIES="$MANIFEST_ENTRIES{\"module\":\"$module\",\"source\":\"mncs/$name.mncs\",\"source_sha256\":\"$source_sha\",\"artifact\":\"public/mncs/$name.wasm\",\"artifact_sha256\":\"$artifact_sha\",\"artifact_bytes\":$artifact_bytes},"
done

MANIFEST_ENTRIES="[${MANIFEST_ENTRIES%,}]"
python3 - "$OUT/manifest.json" "$COMPILER_REV" "$MANIFEST_ENTRIES" <<'EOF'
import json, sys
out, compiler_rev, entries = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
json.dump({"schema_version": "scratchtrack.mncs-wasm-manifest/1",
           "compiler": {"repository": "epi13/mncs-language", "revision": compiler_rev,
                        "backend": "portable-wasm"},
           "artifacts": entries}, open(out, "w"), indent=1)
open(out, "a").write("\n")
EOF

echo "built $(python3 -c "import json; print(len(json.load(open('$OUT/manifest.json'))['artifacts']))") artifacts -> $OUT (compiler $COMPILER_REV)"
