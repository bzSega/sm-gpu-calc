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
