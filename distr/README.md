# SM GPU Calc — static distribution

Open `index.html`: workload → queue → GPU replicas → results. Demo, manual load
and CSV; inline GPU memory view, timeline, variant comparison, CSV results and
JSON scenario save/replay. RU/EN. All calculation stays in the browser.

Keep `sim-core.js` and `scenario-core.js` next to the HTML, including for file://.
`simulation.html` is the same workspace at the existing simulation URL.

Build a release from the repository root: `bash scripts/release.sh`.
Deploy only the ZIP allowlist, not an arbitrary recursive copy of a local folder.
`VERSION.txt` identifies the build; dirty marks uncommitted source changes.
The script builds locally and does not upload to hosting.

FIFO: 1–256 concurrent requests per replica, KV-aware admission, user-defined
solo rates and an illustrative shared-throughput curve. Hardware/model
profiles. Memory is an equal-shard FP8/FP16 estimate with explicit runtime reserve.
No hardware-calibrated batching, prefix caching, interconnect or DAG execution.

The release script versions both JavaScript URLs with content hashes. Deploy
the whole ZIP together so browsers cannot combine new HTML with cached old JS.
If deploying manually after editing JavaScript, rebuild first.
