#!/usr/bin/env bash
# ScratchTrack MNCS verifier: establishes the pressure-boundary claim.
#
# Runs, in order: toolchain pin check, full MNCS evidence replay
# (scripts/mncs-evidence.sh over all product modules and both backends),
# production-WASM freshness (rebuild from source, byte-compare with the
# checked-in artifacts), TypeScript typecheck, app tests, production
# build. Writes .mncs/verification-result.json
# (schema mncs.verification-result/1) and copies evidence into
# .mncs/evidence/.
#
# Environment:
#   MNCS_LANGUAGE_DIR  mncs-language checkout (default: ../mncs-language)
#   MNCS_LANGUAGE_REV  required compiler revision (default: pinned below)
# Exits nonzero on any gate failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MNCS_DIR="${MNCS_LANGUAGE_DIR:-$(cd "$ROOT/../mncs-language" && pwd)}"
PINNED_REV="8d79250d54d4e4241c0bb0ae6f5c632345848a6d"
WANT_REV="${MNCS_LANGUAGE_REV:-$PINNED_REV}"
RESULT="$ROOT/.mncs/verification-result.json"
EVIDENCE="$ROOT/.mncs/evidence"
mkdir -p "$ROOT/.mncs" "$EVIDENCE"

checks=""
pass_count=0
fail_count=0

record() {
  local id="$1" verdict="$2" summary="$3"
  checks="$checks{\"id\":\"$id\",\"verdict\":\"$verdict\",\"summary\":\"$summary\"},"
  if [ "$verdict" = "PASS" ]; then pass_count=$((pass_count + 1)); else fail_count=$((fail_count + 1)); fi
  echo "[$verdict] $id: $summary"
}

# 1. Toolchain pin: the exact compiler revision the evidence binds to.
if [ -d "$MNCS_DIR/.git" ] && [ "$(git -C "$MNCS_DIR" rev-parse HEAD)" = "$WANT_REV" ] \
  && command -v cargo >/dev/null && command -v node >/dev/null; then
  record "mncs-toolchain" "PASS" "mncs-language at $WANT_REV with cargo+node present."
else
  record "mncs-toolchain" "FAIL" "need mncs-language at $WANT_REV (MNCS_LANGUAGE_DIR=$MNCS_DIR)."
fi

# 2. Full evidence replay (study + both backends + agreement + live WASM).
if [ "$fail_count" = "0" ] && "$ROOT/scripts/mncs-evidence.sh" > "$EVIDENCE/evidence.log" 2>&1; then
  record "mncs-evidence" "PASS" "all modules elaborate; corpora agree on both backends; live WASM calls agree (see evidence.log)."
else
  tail -n 5 "$EVIDENCE/evidence.log" 2>/dev/null || true
  record "mncs-evidence" "FAIL" "evidence replay failed; see .mncs/evidence/evidence.log."
fi

# 3. Production-WASM freshness: rebuild from source, byte-compare.
# Independent like every other gate (costs a rebuild even when evidence
# is red, so the check records what it actually measured).
if true; then
  FRESH="$(mktemp -d)"
  if MNCS_WASM_OUT="$FRESH" "$ROOT/scripts/mncs-wasm-build.sh" > "$EVIDENCE/wasm-build.log" 2>&1 \
    && python3 - "$FRESH" "$ROOT/public/mncs" <<'EOF'
import json, sys
from pathlib import Path
fresh, checked = Path(sys.argv[1]), Path(sys.argv[2])
manifest = json.load(open(checked / "manifest.json"))
ok = True
for entry in manifest["artifacts"]:
    name = Path(entry["artifact"]).name
    a, b = (fresh / name).read_bytes(), (checked / name).read_bytes()
    if a != b:
        print(f"STALE: {name}"); ok = False
    src = checked.parent.parent / entry["source"].replace("public/", "")
    import hashlib
    if hashlib.sha256(src.read_bytes()).hexdigest() != entry["source_sha256"]:
        print(f"SOURCE DRIFT: {entry['source']}"); ok = False
sys.exit(0 if ok else 1)
EOF
  then
    record "mncs-wasm-fresh" "PASS" "rebuilt artifacts byte-match; manifest binds sources."
  else
    record "mncs-wasm-fresh" "FAIL" "checked-in WASM is stale vs rebuilt-from-source; see wasm-build.log."
  fi
  rm -rf "$FRESH"
fi

# 4-6. Product gates. Each gate runs independently so a failure records
# against the gate that actually failed — never masked by short-circuit.
if (cd "$ROOT" && npx tsc -b --pretty false > "$EVIDENCE/typecheck.log" 2>&1); then
  record "app-typecheck" "PASS" "tsc -b clean."
else
  record "app-typecheck" "FAIL" "typecheck failed; see .mncs/evidence/typecheck.log."
fi

if (cd "$ROOT" && npx vitest run > "$EVIDENCE/tests.log" 2>&1); then
  record "app-tests" "PASS" "vitest suite green."
else
  record "app-tests" "FAIL" "app tests failed; see .mncs/evidence/tests.log."
fi

if (cd "$ROOT" && npx vite build > "$EVIDENCE/build.log" 2>&1); then
  record "app-build" "PASS" "vite production build clean."
else
  record "app-build" "FAIL" "production build failed; see .mncs/evidence/build.log."
fi

# Result document + evidence copies.
if [ "$fail_count" = "0" ]; then verdict="PASS"; else verdict="FAIL"; fi
python3 - "$RESULT" "$verdict" "$pass_count" "$fail_count" "$checks" <<'EOF'
import json, sys
path, verdict, passed, failed, raw = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
checks = json.loads("[" + raw.rstrip(",") + "]")
json.dump({"schema_version": "mncs.verification-result/1", "verdict": verdict,
           "summary": f"ScratchTrack MNCS pressure boundary: {passed} passed, {failed} failed.",
           "checks": checks}, open(path, "w"), indent=1)
open(path, "a").write("\n")
EOF
cp "$ROOT/public/mncs/manifest.json" "$EVIDENCE/wasm-manifest.json"
cp "$RESULT" "$EVIDENCE/verification-result.json"

echo "verdict: $verdict ($pass_count passed, $fail_count failed)"
[ "$fail_count" = "0" ]
