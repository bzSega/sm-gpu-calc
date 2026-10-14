# Contributing

[Project overview](README.md) · [Русская документация](README.ru.md)

Open an issue or pull request at [sm-gpu-calc](https://github.com/bzSega/sm-gpu-calc).
Describe the problem, expected behavior, and a reproducible URL or sample workload.
Keep each change focused. For calculation changes, explain formulas, units, sources
and assumptions; include meaningful semantic tests.

## Architecture and design

- `simulation.html` contains the unified UI, inline styles and UI logic.
- `sim-core.js` and `scenario-core.js` stay DOM-free and dependency-free.
- Preserve static hosting, file:// support with adjacent JS files, RU/EN, URL settings
  and local-only processing of uploaded workloads.
- Preserve the 1920×1080 scaled stage, dark grid, cream text, coral weights and mint KV.
- Replica detail opens within the same scenario and shares playback state.
- Update the UI through its central `update()` and keep calculations in the core.
- Profiles and throughput curves are educational assumptions unless calibrated.

See [the calculation and visual contract](docs/UNIFIED-SCENARIO.md) (Russian).

## Validation

```sh
node --test tests/sim-core.test.js
bash scripts/render-check.sh simulation.html '?lang=en' /tmp/overview-en.png
bash scripts/render-check.sh simulation.html '?lang=ru&drill=1' /tmp/rack-ru.png
```

Run render checks sequentially. They require Bash, Python 3 and Chrome; set
`CHROME_BIN` if needed. Inspect each fresh screenshot for clipping and overlap,
and investigate runtime errors. A JavaScript syntax check alone is insufficient.
Cover relevant edge cases, language and scaling changes. Test CSV/JSON import,
export and playback when affected. Documentation-only changes need a content and
link review; screenshot changes need visual inspection.

## Distribution

```sh
bash scripts/release.sh
```

This synchronizes `simulation.html` to `distr/index.html` and `distr/simulation.html`,
copies both cores, versions JS URLs by content hash, runs tests and render checks,
and creates a ZIP in `releases/`. Inspect the resulting screenshots and ZIP.
Deploy the entire ZIP together; the script does not upload to hosting.
