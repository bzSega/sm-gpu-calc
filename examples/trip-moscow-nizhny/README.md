# Example trace: trip-planning agent (Moscow → Nizhny Novgorod)

**Date:** 2026-09-28
**Origin:** demo request executed through the SM GPU Calc trace pipeline.
**Privacy:** fully anonymized — generic request text, no personal data, no real user identifiers, no real bookings.

## What this is

The calculator's **Example** button uses the live OpenClaw run: **3 users starting
5 seconds apart × 6 calls = 18 model calls**, with **84,600 input / 7,200 output
tokens** in total. Each user replays the arrival offsets and token counts in
`requests-live.csv`. Per-call token allocation is reconstructed from measured
provider totals (28,200 input / 2,400 output per user), not measured per-call usage.

The simulator replays fixed arrivals. `depends_on` remains metadata: later calls
do not wait for earlier calls to finish in the simulation. The original seven-step
proxy trace is retained as a separate format/generator example.

## Files

| File | Purpose |
|---|---|
| `requests-live.csv` | Six calls from the live run; source for the UI demo |
| `live_run.md` | Timing and token provenance; reconstruction method |
| `guide.md` | Output of the live trip-planning run |
| `prompt.md` | The anonymized user request |
| `steps/01…07-*.md` | Outputs of the earlier seven-step illustrative pipeline |
| `build_trace.py` | Rebuilds the earlier proxy trace from those steps |
| `requests.csv` | Earlier seven-call proxy trace; not the UI demo |
| `manifest.json` | Metadata for the earlier proxy trace |

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

## Token accounting for the earlier proxy trace

In `requests.csv`, `token_count_source = proxy_estimate` — tokens are estimated from output character counts
(`chars / 2.7` for Russian text, rounded), **not** measured by a provider tokenizer.
Do not treat these numbers as measured usage. Replace with real telemetry when importing
from an actual provider (`provider_usage`).

## Rebuilding

```sh
python3 build_trace.py
```

Regenerates `requests.csv` and `manifest.json` from `prompt.md` + `steps/`.
