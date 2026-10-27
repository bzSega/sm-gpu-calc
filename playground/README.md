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

Server room, workshop and orbital station are interchangeable settings. Change
world in settings or in an object window’s header. Time, work, queue and selected
object stay intact; the setting never affects serving calculations.

## Working service

- The service runs continuously, including while in-game menus are open. There
  are no play/pause, speed or timeline controls.
- A day takes six real minutes. The **same fixed scale** applies to clock,
  arrivals and processing. Morning/rush/night repeat; queued work is not reset.
- Popularity controls new people per model minute in the morning. Rush hour is
  ×10; night is ×0.5. These are teaching assumptions, not measured traffic.
- One person sends one request. Choose regular requests (10,000 input / 1,000
  output tokens) or long documents (120,000 / 8,000). The choice affects only
  future visitors. Existing calls keep their original tokens and KV.
  Each copy initially permits 2 active calls with 25% sharing gain. Change the
  limit through processing settings; the copy drains first. Solo rates are the
  existing model-profile assumptions; changing GPU memory does not derive a new
  hardware benchmark.
- Up to 64 copies can accept waiting work independently. The compact overview
  shows every copy and its active requests/KV; select one to inspect its GPUs.
- Changing a live copy’s GPUs drains its active work on the old configuration
  before applying the new placement. New requests wait or use other copies.
  Invalid placements are rejected before changing anything.
- A rack's occupied places and its KV memory are separate indicators. Click a copy/card for exact values.
- Envelopes summarize actual arrival/completion changes. Their travel is visual
  feedback, not an extra processing stage. Reduced motion removes flying
  packets without stopping the model or hiding counts.

## Learning tasks

Six optional tasks observe the same service: place a model, send a reply,
clear a queue despite free KV, compare request lengths, find a memory
constraint, and change the launch limit. A task requires an observed outcome
and a short explanation question. Wrong answers give an explanation without
penalties. Buttons alone do not complete a task.

The memory experiment is derived from the selected model and shared memory
checks. It is a teaching setup, not an optimal hardware recommendation.
Switch to sandbox at any time without resetting work or learning progress.
Progress is local and included in JSON saves (`ai-startup-lessons/1`).
Technical checks cover task transitions; usability with real beginners is
still to be evaluated.

## Saving

The browser saves locally every15seconds and on important actions, hiding or
leaving the page. `Continue` restores the service without offline catch-up.
No workload is sent over the network or included in the URL.

Settings provide save-file download/import (JSON, max8MiB). Starting fresh
requires confirmation and retains a previous local save, recoverable from
settings. Storage errors are reported; use download when browser storage is full.
Selected copy and an open copy/GPU/overview window are saved too. Older saves
without this presentation state open with copy 1 selected.
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
| lessons.js | Outcome checks, explanatory questions and local learning progress |
| presentation.js | Pool geometry and validated saved object selection |
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
RU/EN, keyboard activation and narrow layout. Generated environment, cabinet and visitor art is combined with live SVG
GPU modules and memory indicators. Cabinets represent logical model groups,
not a measured physical rack layout. Hardware detail is illustrative.
