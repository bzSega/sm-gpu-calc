# AI Startup Playground

Separate playable prototype on the shared GPU Calc event engine. The current
calculator, `distr/` and hosted website are not replaced by this subproject.

## Play locally

From the repository root:

```sh
python3 -m http.server 8030
# http://127.0.0.1:8030/playground/?lang=ru
# http://127.0.0.1:8030/playground/?lang=en
```

Start → empty rack → install GPUs → choose a model → open the service.
Click objects for contextual controls. On small screens, the bottom object dock
provides the same actions. Model placement errors can be repaired by changing
GPUs or choosing another model.

The server room is playable. Workshop and orbital-station thumbnails are concept
previews; they are disabled in this slice. The underlying session already keeps
world choice separate from calculation. [Concept art](assets/worlds-concept.png).

## Working service

- The service runs continuously, including while in-game menus are open. There
  are no play/pause, speed or timeline controls.
- A day takes six real minutes. The **same fixed scale** applies to clock,
  arrivals and processing. Morning/rush/night repeat; queued work is not reset.
- Popularity controls new people per model minute in the morning. Rush hour is
  ×10; night is ×0.5. These are teaching assumptions, not measured traffic.
- One person sends one request:10,000 input and1000 output tokens in this slice.
  Each copy permits2 active calls with25% sharing gain. Solo rates are the
  existing model-profile assumptions; changing GPU memory does not derive a new
  hardware benchmark.
- More copies can accept waiting work independently. A rack's occupied places
  and its KV memory are separate indicators. Click a copy/card for exact values.
- Envelopes summarize actual arrival/completion changes. Their travel is visual
  feedback, not an extra processing stage. Reduced motion removes flying
  packets without stopping the model or hiding counts.

## Saving

The browser saves locally every15seconds and on important actions, hiding or
leaving the page. `Continue` restores the service without offline catch-up.
No workload is sent over the network or included in the URL.

Settings provide save-file download/import (JSON, max8MiB). Starting fresh
requires confirmation and retains a previous local save, recoverable from
settings. Storage errors are reported; use download when browser storage is full.
Browser schema `ai-startup-browser/1` wraps the separate construction and live
session formats. It is not the calculator's CSV/scenario format.

The prototype retains at most10,000 calls and30,000 live actions. On a request
quota error the UI stops new arrivals and keeps processing existing work; it
never truncates a queue. Live observed model time is bounded by1e9ms. Unlimited
history and offline progression are not implemented.

## Files

| File | Purpose |
| --- | --- |
| index.html / game.css / app.js | Browser UI, contextual panels, local persistence |
| scene.js | Data-driven isometric SVG foreground over the generated environment |
| startup.js | Empty-rack construction and placement validation |
| clock.js | Fixed shared wall/model scale, visibility reset |
| session.js | Continuous visitors/day-cycle controller |
| ../sim-core.js | One serving event engine for finite and live execution |
| ../scenario-core.js | Shared profiles, memory checks and settings |

No framework, npm install or backend is required. All resources are local.
[Art provenance and prompt](assets/README.md) · [Live API](../docs/LIVE-SESSION.md)
· [Calculation contract](../docs/UNIFIED-SCENARIO.md).

## Check

```sh
node --test tests/*.test.js
```

Browser checks cover construction, invalid placement, live arrivals, queues,
copy expansion, card memory, persistence/reload and downloaded-file import,
RU/EN, keyboard activation and narrow layout. The foreground is still simple
prototype art; sprite-level hardware detail is not a physical GPU specification.
