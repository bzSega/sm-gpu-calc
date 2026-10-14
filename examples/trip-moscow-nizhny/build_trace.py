#!/usr/bin/env python3
"""Build a workload trace (requests.csv + manifest.json) from the step outputs.

Token accounting: proxy estimate from character counts (chars/2.7 for Russian
text). Marked token_count_source=proxy_estimate — NOT provider telemetry.

DAG semantics (proposal §5.1): arrival_ms = max(finish of depends_on) + gap,
where finish = arrival + nominal service seconds (chars/150 chars/sec read-
rate stand-in). This only defines plausible arrival times; the simulator
recomputes the real schedule.
"""
import csv, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS = [  # (id, file-stem, depends_on)
    ("s1", "01-parse-request", []),
    ("s2", "02-route-leg", ["s1"]),
    ("s3", "03-poi-nizhny", ["s1"]),
    ("s4", "04-meals", ["s3"]),
    ("s5", "05-itinerary-full", ["s2", "s3", "s4"]),
    ("s6", "06-maps-payload", ["s5"]),
    ("s7", "07-pdf-guide", ["s5"]),
]
GAP_MS = 500
CHARS_PER_TOKEN = 2.7      # RU text proxy
NOMINAL_CHARS_PER_SEC = 150  # only to derive plausible arrival times

def est_tokens(path):
    text = open(path, encoding="utf-8").read()
    return max(1, round(len(text) / CHARS_PER_TOKEN))

def main():
    prompt_tokens = est_tokens(os.path.join(HERE, "prompt.md"))
    finish = {}
    rows = []
    for sid, stem, deps in STEPS:
        out_tok = est_tokens(os.path.join(HERE, "steps", f"{stem}.md"))
        ctx_tok = sum(finish[d][1] for d in deps)  # context: prior outputs
        in_tok = prompt_tokens + ctx_tok
        arrival = max([finish[d][0] + GAP_MS for d in deps], default=0)
        nominal_sec = out_tok * CHARS_PER_TOKEN / NOMINAL_CHARS_PER_SEC
        done = arrival + round(nominal_sec * 1000)
        finish[sid] = (done, out_tok)
        rows.append({
            "request_id": sid,
            "arrival_ms": arrival,
            "model_profile_id": "glm53-flash",
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "token_count_source": "proxy_estimate",
            "job_id": "trip-msk-nnovy",
            "depends_on": ";".join(deps) if deps else "",
        })

    with open(os.path.join(HERE, "requests.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    manifest = {
        "schema_version": "1.0",
        "workload": {"file": "requests.csv", "mode": "closed_loop_dag_demo"},
        "deployment": {
            "model_profile_id": "glm53-flash",
            "hardware_profile_id": "h200-8g",
            "gpus_per_replica": 8,
            "replicas": 1,
        },
        "service_model": {"kind": "educational_stub"},
        "simulation": {"seed": 42, "arrival_horizon_ms": finish["s7"][0] + 1000,
                       "drain_after_horizon": True},
        "economics": {"currency": "USD", "gpu_monthly_cost": 3000,
                      "billing_days": 30, "revenue_mode": "none"},
        "provenance": {
            "description": "Anonymized demo: agentic trip-planning task split into 7 model calls (DAG).",
            "prompt_file": "prompt.md",
            "step_outputs": "steps/",
            "token_count_source": "proxy_estimate",
            "chars_per_token_assumed": CHARS_PER_TOKEN,
            "privacy": "no personal data; fully synthetic reproducible example",
        },
    }
    with open(os.path.join(HERE, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"OK: {len(rows)} requests, prompt={prompt_tokens} tok, "
          f"span={finish['s7'][0]} ms")

if __name__ == "__main__":
    main()
