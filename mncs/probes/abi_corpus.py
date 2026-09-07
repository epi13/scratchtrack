#!/usr/bin/env python3
"""Build experiment corpora from `mncs abi` output.

Usage: abi_corpus.py <abi.json> <spec.json> <out-corpus.json>
spec.json: {"cases": [{"function": str, "args": [...], "expect": str}], "budgets": {...}}
ABI supplies exact type_identity strings; spec supplies values.
Value DSL:
  {"B": true}                 boolean
  {"I": 3}                    integer (ty inferred: u32 if >=0 else i32)
  {"F": "TypeName"}           finite unit variant, discriminant by ABI order
  {"R": {"field": value}}     record, fields emitted in ABI order
"""
import json, sys

abi_path, spec_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
abi = json.load(open(abi_path))
spec = json.load(open(spec_path))
fns = abi["functions"]
composites = abi.get("composites", {})

def finite_by_name(name):
    comp = composites[name]["finite"]
    return comp["type_identity"], comp["variants"]

def build_finite(type_name, variant_short):
    tid, variants = finite_by_name(type_name)
    # variants: {"0": identity, ...} in doc order
    for disc_str, vid in variants.items():
        if vid.endswith("::" + variant_short):
            return {"finite": {"type_identity": tid, "variant_identity": vid,
                               "discriminant": int(disc_str), "payload": []}}
    raise ValueError(f"variant {variant_short} not in {type_name}: {variants}")

def build_record(type_name, field_vals):
    comp = composites[type_name]["record"]
    fields = []
    for fname, _ftype in comp["fields"]:
        if fname not in field_vals:
            raise ValueError(f"missing field {fname} for {type_name}")
        fields.append([fname, build_value(field_vals[fname], _ftype)])
    return {"record": {"type_identity": comp["type_identity"], "name": type_name, "fields": fields}}

def build_value(v, hint=None):
    if isinstance(v, dict) and set(v.keys()) == {"B"}:
        return {"boolean": {"value": bool(v["B"])}}
    if isinstance(v, dict) and set(v.keys()) == {"I"}:
        spec = v["I"]
        if isinstance(spec, list):
            n, ty = int(spec[0]), spec[1]
        else:
            n, ty = int(spec), ("u32" if int(spec) >= 0 else "i32")
        import re as _re
        m = _re.fullmatch(r"([iu])(\d+)", ty)
        bits, signed = int(m.group(2)), m.group(1) == "i"
        return {"integer": {"value": n, "type": {"bits": bits, "signed": signed}}}
    if isinstance(v, dict) and set(v.keys()) == {"F"}:
        # hint carries the finite type name when ambiguous
        return build_finite(hint, v["F"])
    if isinstance(v, dict) and set(v.keys()) == {"R"}:
        return build_record(hint, v["R"])
    raise ValueError(f"bad value DSL: {v} hint={hint}")

def arg_hint(fn_contract, idx):
    inp = fn_contract["inputs"][idx]
    if "record" in inp:
        return inp["record"]["name"]
    if "finite" in inp:
        # find composite name by type_identity
        tid = inp["finite"]["type_identity"]
        for name, comp in composites.items():
            if "finite" in comp and comp["finite"]["type_identity"] == tid:
                return name
        return None
    return None

out_cases = []
for case in spec["cases"]:
    fn = fns[case["function"]]
    args = [build_value(v, arg_hint(fn, i)) for i, v in enumerate(case["args"])]
    entry = {
        "id": case.get("id", case["function"]),
        "request": {
            "schema_version": "0.1",
            "target": {"module": abi["module"], "function": case["function"]},
            "arguments": args,
            "step_budget": spec.get("step_budget", 10000),
        },
    }
    if "expected_status" in case:
        entry["expected_status"] = case["expected_status"]
    if "expected" in case:
        entry["expected"] = [build_value(v, None) for v in case["expected"]]
    out_cases.append(entry)

json.dump({"schema_version": "0.1", "name": spec.get("name", "probe"),
           "cases": out_cases}, open(out_path, "w"), indent=1)
print(f"wrote {len(out_cases)} cases -> {out_path}")
