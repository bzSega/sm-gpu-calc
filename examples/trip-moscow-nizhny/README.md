# Example trace: trip-planning agent (Moscow → Nizhny Novgorod)

**Date:** 2026-09-28
**Origin:** demo request executed through the SM GPU Calc trace pipeline.
**Privacy:** fully anonymized — generic request text, no personal data, no real user identifiers, no real bookings.

## What this is

A worked example of an **agentic workload**: one user task decomposed into 7 model calls with dependencies (DAG). It demonstrates the `depends_on` fields from the development proposal (§5.1) — this is a *closed-loop / DAG* workload, which the simulation core will support after the open-loop MVP.

## Files

| File | Purpose |
|---|---|
| `prompt.md` | The anonymized user request (verbatim input to the agent) |
| `steps/01…07-*.md` | Output of each pipeline step (compact but real content) |
| `build_trace.py` | Deterministic script: reads steps, estimates tokens, emits `requests.csv` + `manifest.json` |
| `requests.csv` | Workload trace, one row = one model call |
| `manifest.json` | Scenario package manifest per proposal §5.3 |

## From one request to users and RPS

The live run gives a realistic per-request budget: **~31k tokens (28.2k in / 2.4k out), 6 model calls, ~64 s wall time**. That turns one trace into capacity math:

- `requests/day = users × requests_per_user_per_day`
- `avg req/s = requests/day / 86400`; size for peak ≈ 5× average
- One 8×H200 replica at an assumed **~1,500 tok/s output** serves ≈ `1500 / 2400 ≈ 0.6 req/s` (output-bound; assumption, not benchmark)
- At full utilization: **~$0.015 per request** (8 GPUs × ~$0.00116/GPU-s × 1.6 s busy)

| Scenario | Users | Req/user/day | Req/day | avg req/s | peak ×5 | Replicas | GPUs | Cost/month |
|---|---|---|---|---|---|---|---|---|
| Pilot | 10k | 0.2 | 2k | 0.02 | 0.12 | 1 | 8 | $3k |
| Growing | 100k | 0.5 | 50k | 0.58 | 2.9 | 5 | 40 | $120k |
| Mass | 1M | 0.5 | 500k | 5.8 | 29 | 48 | 384 | $1.15M |

Throughput is the assumption the simulator lets you vary (see `manifest.json` →
`deployment`), so plug in your own model profile and hardware. The point of the
example: **one measured request → users, RPS, replicas and dollars.**

## Token accounting honesty

`token_count_source = proxy_estimate` — tokens are estimated from output character counts
(`chars / 2.7` for Russian text, rounded), **not** measured by a provider tokenizer.
Do not treat these numbers as measured usage. Replace with real telemetry when importing
from an actual provider (`provider_usage`).

## Rebuilding

```sh
python3 build_trace.py
```

Regenerates `requests.csv` and `manifest.json` from `prompt.md` + `steps/`.
