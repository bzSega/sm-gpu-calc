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

- The header's Fullscreen button enters/exits browser fullscreen; Esc exits
  when no dialog is open. Dialogs remain part of the game. Unsupported or denied
  fullscreen requests display a message; fullscreen is never restored without
  a user gesture.
- The service runs continuously, including while in-game menus are open. There
  are no play/pause, speed or timeline controls.
- The clock shows “One day in6minutes” and opens a concrete time explanation
  on click: one screen second represents four service minutes.
- A day takes six real minutes. The **same fixed scale** applies to clock,
  arrivals and processing. Morning/rush/night repeat; queued work is not reset.
- The RPS counter is explicitly labeled “Whole service”; its help separates
  service, copy and shared GPU work using a marked hypothetical4=3+1example.
- Incoming RPS counts actual arrivals in the last60 game seconds and divides
  by60, including queued requests. Click the counter for its formula. It is
  traffic to the whole service, not hardware utilization or maximum throughput;
  GPUs within one copy work together. The first minute includes zero traffic
  before opening. Old compact saves without traffic history collect a new
  minute before displaying a value; old journals can recover the exact window.
- Popularity controls new people per model minute in the morning. Rush hour is
  ×10; night is ×0.5. These are teaching assumptions, not measured traffic.
- Visitor settings explicitly show “1user → 1request”, with a10user/10request
  example for this teaching scenario.
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
- The program's concurrent-request limit and memory capacity are separate.
  A limit of2 keeps a third request waiting even with spare memory. Processing
  settings show both values; the game's1–256 setting range is explicitly a
  simulator bound, not a GPU or real serving-program specification.
- KV cache is temporary request memory for intermediate text computations.
  Lessons explain it before asking about it. The game frees it after a reply;
  model weights remain. Click a copy/card for exact memory values.
- Processing help introduces the role of serving programs, with links to vLLM
  and Hugging Face TGI. Their distinct real controls are not simulated in full.
- Envelopes summarize actual arrival/completion changes. Their travel is visual
  feedback, not an extra processing stage. Reduced motion removes flying
  packets without stopping the model or hiding counts.

## Learning tasks

Six optional tasks observe the same service: place a model, send a reply,
clear a queue despite free KV, compare request lengths, find a memory
constraint, and change the launch limit. A task requires an observed outcome
and a short explanation question. Wrong answers give an explanation without
penalties. Correct and incorrect choices use text, icons and color; a separate
feedback card shows the explanation in both cases. Short answer sounds can be
disabled in settings and never replay when restoring progress. Buttons alone
do not complete a task.

The memory experiment is derived from the selected model and shared memory
checks. It is a teaching setup, not an optimal hardware recommendation.
Switch to sandbox at any time without resetting work or learning progress.
Progress is local and included in JSON saves (`ai-startup-lessons/1`).
Technical checks cover task transitions. An observed beginner walkthrough
identified unclear terms and controls; explanations and interactions were revised.
This small formative check is not evidence of a general learning success rate.

## Saving

The browser saves locally every15seconds and on important actions, hiding or
leaving the page. `Continue` restores the service without offline catch-up.
No workload is sent over the network or included in the URL.

Settings provide save-file download/import (JSON, max8MiB). Import keeps the
current interface language; a saved service cannot silently switch RU to EN.
Changing language in settings also updates the URL, so reload keeps that choice. Starting fresh
requires confirmation and retains a previous local save, recoverable from
settings. Storage errors are reported; use download when browser storage is full.
Selected copy and an open copy/GPU/overview window are saved too. Older saves
without this presentation state open with copy 1 selected.
Browser schema `ai-startup-browser/1` wraps the separate construction and live
session formats. It is not the calculator's CSV/scenario format.

The playable service has no lifetime 10,000-call stop. Completed history is
summarized into lifetime counters, a recent reply window and teaching witnesses.
Waiting requests remain intact: consecutive identical requests with exact
arrival progressions use lossless FIFO runs. This is storage compression, not
request sampling or a change to GPU capacity. A varied or heavily overloaded
queue can still grow; browser storage/import limits remain explicit.

Live game saves use `ai-startup-session/2` with a validated operational
checkpoint (`sm-gpu-live-recent/1`). Old journal-based saves migrate on load
without restarting active work or erasing pending calls. A checkpoint preserves
the event anchor separately from the observed time, remaining work, maintenance,
queue, rates and lifetime counters. Archived historical counters are saved game
data, not independently replayable measurements. If an older version already
stopped arrivals, set the desired arrival rate again; its previous value was
not retained. Offline progression is not implemented.

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

## Separate release

Run `python3 scripts/release-playground.py` from the repository root. Python 3
and Node.js are required to build; players need only a static server and browser.
The command runs the semantic tests, packages an explicit public allowlist and
prints the ZIP path and SHA-256. The ZIP contains its own launch README and
SHA-256 manifest. Identical allowlisted sources produce identical ZIP bytes.
It never edits `distr/`, uploads files or includes local saves, plans, agent
instructions, concept sheets or repository history. Extract the ZIP to a new
directory and serve that directory; open `/playground/`. Keep the whole layout,
including both adjacent shared cores. Save JSON before changing origin.

On phones, drag the location with one finger to reach off-screen objects. Tap an object to open it, or use the Rack / Service / User traffic buttons at the bottom. Panels scroll normally. / На телефоне двигайте локацию одним пальцем; нажмите на объект или используйте кнопки внизу. Панели прокручиваются как обычно.

Touch navigation uses a 1.4× movement gain; mouse dragging stays 1:1. Mobile forms use larger hit areas, reflowing actions and messages inside the active dialog. On short portrait screens the tutorial is compact; open its task button for the full explanation. Browser checks cover 320/360 px portrait and short landscape layouts, but do not replace testing Safari/Chrome and the on-screen keyboard on a physical phone.
