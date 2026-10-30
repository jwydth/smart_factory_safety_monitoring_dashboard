# Architecture

How the system is built: what each part does, how the parts connect, and the
reasoning behind the decisions that look strange.

**This document supersedes `docs/CODEBASE_OVERVIEW.md` and
`docs/CHANGES_SINCE_OVERVIEW.md`**, which were a snapshot (as of 2026-08-10) plus a
delta on top of it. They are kept in `docs/archive/` for history. Current as of
commit `950e09c`.

Three reference documents are **generated from the code** and are authoritative where
they overlap with this one:

- [CONFIGURATION.md](./CONFIGURATION.md) — every setting
- [API.md](./API.md) — every endpoint
- [DATABASE.md](./DATABASE.md) — every table, column, foreign key and index

See also [MODELS.md](./MODELS.md), [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) and
[OPERATIONS.md](./OPERATIONS.md).

---

## 1. What the system does

Cameras — live RTSP or uploaded video — are analysed in real time for:

- **PPE compliance** — helmet, vest and cleaning-coverall detection
- **Zone incursions** — polygon zones with dwell thresholds
- **Dangerous behaviour** — running and falling, via a pose-based classifier

Incidents are persisted with an evidence snapshot, pushed live to a Next.js dashboard
over WebSocket, aggregated into analytics, and exportable as a PDF report on demand or
on a schedule.

A server-side compositor burns every AI result into the video itself and republishes
it as an annotated LL-HLS stream, so the dashboard plays one already-synchronised
picture rather than racing a browser-drawn overlay against an independent video
element.

## 2. Tech stack

**Backend** — Python 3.11, FastAPI, SQLModel/SQLAlchemy, PostgreSQL, MinIO,
Ultralytics YOLO (PPE, pose, sign), BoT-SORT/ByteTrack tracking, scikit-learn
`ExtraTreesClassifier` (behaviour), FFmpeg, MediaMTX, ReportLab (PDF), APScheduler,
smtplib.

**Frontend** — Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4,
`@tanstack/react-query`, `hls.js`, `recharts`, `three`/`@react-three/fiber`,
`lucide-react`.

## 3. High-level flow

```
 Camera (RTSP) / uploaded video
        │
        ▼
 CameraFrameHub (one cv2.VideoCapture per source, shared)
        │  "latest" and "ordered" subscriptions
        ├──────────────┬───────────────┬────────────────────┐
        ▼              ▼               ▼                     ▼
   PPE detector    Sign worker    Behavior worker       Annotated
   (YOLO + track)  (YOLO sign)    (Pose + ExtraTrees)   compositor
        │              │               │                     │
        └──────┬───────┴───────┬───────┘                     │
               ▼               ▼                             │
        video_pipeline (PPE + zone + sign + behavior)         │
               │                                             │
     ┌─────────┼─────────────────┐                            │
     ▼         ▼                 ▼                            ▼
 PPEViolation ZoneViolation  BehaviorIncident          FFmpeg → MediaMTX
 (Postgres +   (Postgres +    (Postgres +              (_annotated → LL-HLS)
  MinIO)        MinIO)         MinIO)                         │
     │         │                 │                            │
     └─────────┴───────┬─────────┘                            │
                       ▼                                      │
         UnifiedIncidentService / AnalyticsService             │
                       │                                      │
                       ▼                                      ▼
            REST API (FastAPI)  ◄──── WebSocket /ws/stream ────┘
                       │                        │
                       ▼                        ▼
             Next.js dashboard — plays the annotated LL-HLS stream
             and overlays zone-drawing SVG + detection metadata
```

**Two independent transports carry results to the browser.** The WebSocket
(`/ws/stream`) carries timestamped JSON events — violations, suggestions, summaries,
and raw JPEG preview frames for uploaded-file playback. The live camera picture is
**not** sent frame by frame over the socket; the backend composes overlays onto the
video and republishes it as a second RTSP stream (`..._annotated`) which MediaMTX
serves as LL-HLS. An earlier design drew a separate browser-side box layer synced to
raw video by wall clock, and it proved unstable.

---

## 4. Entry point, runtime, config

### `app/main.py`

Configures logging, then calls `configure_inference_runtime()` **before importing any
router.** Order matters: this sets thread-pool environment variables
(`OMP_NUM_THREADS` and friends) and resolves the inference device once, so native
libraries do not each spin up a full-machine thread pool, and every router's
module-level singleton (`PPEDetector()`, `FallDetector()`) inherits the right settings
at import time.

> **Side effect worth knowing:** because those singletons are module-level, *importing*
> `app.main` loads and warms detection models onto the GPU. Anything that imports it —
> including `scripts/generate_docs.py` — needs the weights present.

It then builds the app, enables CORS for `ALLOWED_ORIGINS`, and **exposes the
`Content-Disposition` header** (the frontend parses PDF download filenames from it;
it is not CORS-safelisted by default). All routers mount at root with no prefix.
Local snapshots are served as static files at `/snapshots`.

On startup, an in-process APScheduler `BackgroundScheduler` calls
`check_and_send_scheduled_report()` every 15 minutes. On shutdown it stops the
scheduler, closes all frame hubs, and shuts down the behaviour scheduler.

`GET /health` returns `{"status": "ok"}` unconditionally — a liveness check only. It
reports healthy while the database is down; use `/health/db` for that.

### `app/core/config.py`

121 settings via `pydantic-settings`, loaded from `backend/.env`. See
[CONFIGURATION.md](./CONFIGURATION.md) for the full generated reference. Validators
enforce cross-field invariants — SMTP SSL/STARTTLS mutual exclusivity,
`BEHAVIOR_CAMERA_BURST_SIZE ≤ BEHAVIOR_BATCH_MAX_SIZE`, `FALL_LIVE_FRAME_STRIDE == 1`,
enum membership for `ANNOTATED_ENCODER` and `BEHAVIOR_GMC_METHOD`, IOU thresholds in
`[0,1]`.

### `app/db/session.py`, `app/db/init_db.py`

`get_engine()` normalises `postgres://`/`postgresql://` to `postgresql+psycopg://`,
builds a cached engine with `pool_pre_ping=True`, and **passes `connect_timeout=5`**.
That timeout is load-bearing: libpq blocks in `connect()` indefinitely by default, and
because DB-backed endpoints are `async def` calling synchronous SQLAlchemy, that block
landed on the event loop and froze the whole server — **including already-running
camera WebSockets.** Failing fast turns an unrecoverable hang into a 503.

`create_db_and_tables()` is a manual script (`python -m app.db.init_db`), **not** called
at startup. It runs `create_all()` and seeds three `Feature` rows, renaming a legacy
`fall_detection` row to `behavior_detection` in place so existing
`camera_feature_configs` foreign keys survive.

---

## 5. Data model

[DATABASE.md](./DATABASE.md) is the generated, authoritative reference — 14 tables with
every column, foreign key and index. What follows is the part that needs explaining
rather than listing.

**Three different things are called a "zone".** Conflating them is the single easiest
way to misread this codebase:

| Concept | What it is |
| --- | --- |
| `PhysicalZone` with `zone_type="AREA"` | A coarse factory area. Not drawn. Used for analytics grouping and as a camera's "home zone". |
| `PhysicalZone` + `CameraZoneView` | A **drawn** polygon on one camera's view: `RESTRICTED`, `WALKWAY`, `SLIPPERY` or `IGNORE`. |
| 3D blueprint `ZoneId` | `Z01`/`Z02`/`Z03`, static frontend geometry for the 3D view only. |

### `area_zone_id` — why incidents freeze their zone

All three incident tables carry `area_zone_id` (FK → `physical_zones`, `SET NULL`,
indexed, nullable).

Incidents used to resolve their zone at **read** time by following
`camera_id → cameras.home_zone_id`. Since `camera_id` is `ON DELETE SET NULL`,
deleting a camera dumped its entire recorded history into "Unassigned", and reassigning
a camera's home zone retroactively rewrote the zone of every incident predating the
move. The zone is now frozen onto the row at write time, with a fallback to the
camera's current home zone for older rows.

Do not confuse it with `zone_violations.physical_zone_id`, which is the *drawn* zone a
person entered. `area_zone_id` is the AREA the camera belonged to.

### `zone_violations.severity` — a bug worth understanding

The column is nullable free text, and for a long time **nothing on the write path set
it.** Every incursion ever recorded stored `NULL`. The read layer coerced `NULL` to
"Medium", and the dashboard's Open Incidents figure counts Critical + High — so a
RESTRICTED-zone incursion was detected, stored, and then **never appeared in the one
number an operator watches.** The read-side default is exactly what hid it: the data
looked like a plausible "Medium" rather than obviously-missing.

The write path now derives it (`incident_normalization.default_zone_severity`). Existing
rows are fixed by `scripts/backfill_zone_violation_severity.py`.

### Other notes

- `dwell_threshold_seconds` is a **Float**, despite the old DBML saying integer.
- `ppe_violations` has **no severity column at all** — it is derived from text on read.
- `ReportSchedule` is a **singleton row (id=1)**. There is no auth or multi-tenancy, so
  one global schedule is intentional.
- `ReportDelivery` is an append-only audit log; its `zone_id` has **no FK**, because a
  zone may be deleted after a delivery was recorded.
- `report_schedules.language` (`"en" | "vi"`, `NOT NULL`, default `"en"`).

### There is no migration framework

Schema comes from `SQLModel.metadata.create_all()`, which creates whole missing tables
and **never alters an existing one.** New columns arrive through idempotent patch
scripts. An existing database needs all three; see
[DATABASE.md](./DATABASE.md#migration-scripts) and
[OPERATIONS.md](./OPERATIONS.md).

---

## 6. Severity — one rule, three encodings

Severity drives the headline KPI, the filter chips, the report PDFs and every badge
colour. **There is no single `severity` column to read.** Each category answers the
question differently, and two of three compute it at read time.

`VALID_SEVERITIES = ("Critical", "High", "Medium", "Low")`; Title case is canonical.

### PPE — derived from text, never stored

From `violation_type`, lowercased, first match wins:

| Test | Severity |
| --- | --- |
| contains `proximity` | **Low** |
| contains `_and_` or ` and ` | **High** |
| anything else | **Medium** |

The logic is "how many rules is this person breaking at once". **PPE is never
Critical** — deliberately, so a Critical filter asks the PPE table for *nothing*
(`false()`), not for everything. Order matters: `proximity` is tested before `_and_`.

### Zone — stored, defaulted on both write and read

On write (`default_zone_severity`): `RESTRICTED` → **High**; `SLIPPERY`, `WALKWAY`,
anything else → **Medium**. A keep-out zone exists precisely to catch entry; walkway
and slippery incursions are advisory by comparison.

On read (`normalize_zone_severity`): title-case the stored value, accept it if it is
one of the four, **otherwise Medium**.

### Behaviour — stored uppercase, defaults to High

`running` → **Medium**; everything else → **High**. On read, an unrecognised or `NULL`
value becomes **High**, because the events this category records (a person on the
floor) generally are serious.

### Why the asymmetry forces two "explicit" lists

Zone defaults to Medium, behaviour to High. So filtering for a category's *default*
level cannot be `severity = 'X'` — it must also match `NULL` and every unrecognised
value, or the filtered feed would silently drop rows the UI displays at that level:

```python
_ZONE_EXPLICIT     = ("CRITICAL", "HIGH", "LOW")     # Medium is the fallback
_BEHAVIOR_EXPLICIT = ("CRITICAL", "MEDIUM", "LOW")   # High is the fallback
```

An empty severity list means "nothing was asked for", which is **not** "asked for
nothing" — it leaves the category unfiltered.

### The three encodings — change one, change all three

1. `app/services/incident_normalization.py` — the Python read layer
2. `app/services/incident_filters.py` — the same rule as SQL, so filtering happens
   before `LIMIT`/`OFFSET`
3. `frontend/src/lib/incident-severity.ts` — a client-side mirror

`backend/tests/services/test_incident_filters.py` asserts that for every stored row
the SQL predicate selects exactly the rows the normaliser labels with that severity.
**Nothing checks the TypeScript mirror** — that one is on you.

---

## 7. API

[API.md](./API.md) is generated and authoritative: **38 paths, 50 operations**, plus
the `/ws/stream` WebSocket, which no OpenAPI schema can describe.

Points that need prose:

- **No authentication anywhere.** See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) §1.
- **`POST /predict` returns 500** with real weights loaded. §2 of the same document.
- **`/fall-detection/*` paths are `deprecated=True` aliases** of
  `/behavior-detection/*`, same handlers.
- **`GET /safety-events`** is the server-side paginated, filtered merged incident feed.
- **`GET /stream-snapshot`** serves a JPEG poster frame and **404s past
  `ANNOTATED_SNAPSHOT_MAX_AGE_SECONDS`** rather than presenting stale footage as the
  current view of the floor.
- **Zone routes use query params, not path params** (`GET /zones?video_name=...`),
  deliberately: an RTSP URL like `rtsp://localhost:8554/mystream` breaks path-param
  slash decoding. `DELETE /zones/video` is registered *before* `/zones/{zone_id}` so
  the literal string `"video"` is never matched as an id.
- **`DELETE /violations`** deletes **all** PPE + zone + behaviour incidents in one
  call.

### Analytics handlers are sync `def` on purpose

`app/routers/analytics.py` declares its handlers `def`, not `async def`.
`AnalyticsService` does synchronous SQLAlchemy work and aggregates in Python; as
`async def` that ran directly on the event loop and blocked the whole server — a
single `/analytics/summary` call pushed `/health` from a **4 ms** median to
**1549 ms**, and every camera WebSocket stalled with it. FastAPI runs `def` handlers in
its threadpool instead.

**Do not "fix" these back to `async def`.**

### `active_cameras` vs `live_cameras`

Two deliberately different numbers:

- **`active_cameras`** — cameras that recorded an incident inside the requested range.
  Historical. This is what the PDF report's coverage narrative wants.
- **`live_cameras`** — cameras being streamed *right now*. Point-in-time, independent
  of range. This is what the dashboard KPI shows. Defaults to `0` so report-side
  constructors, describing a past period where "streaming now" is meaningless, need not
  supply it.

### The WebSocket lifecycle

`WS /ws/stream`, query params `video_name`, `enable_ppe`, `enable_zone`, `enable_fall`,
`enable_sign`, `metadata_only`.

- A per-`video_name` `asyncio.Lock` serialises connections to one source; a connecting
  client waits up to 12 s.
- A newer connection **supersedes** an orphaned one, closing the old socket with code
  **4001**. **The frontend must not auto-reconnect on 4001.** This handles browser
  reloads and React StrictMode double-mounts leaking sockets that never send a close
  frame.
- Inbound messages: `update_settings` (toggles and per-camera features),
  `dismiss_suggestion`, `dismiss_ppe_suggestion`, `reload_zones` (hot-reload polygons
  mid-stream), `playback_metrics`. A `ping` is sent if the client is silent for 15 s.
- **Producer/consumer split:** `"frame"` events are coalesced to a single latest-only
  slot — older ones dropped and counted — while every other event type goes on an
  unbounded reliable FIFO that is never dropped. Losing a preview frame is invisible;
  losing a violation is not.
- `update_settings` is sent on `ws.onopen`, not only via a sync effect, so a connection
  opened before per-camera feature config loads does not run with stale flags.
- Teardown fully closes the generator (`aclose`, 6 s timeout) **before** releasing the
  lock, so the next connection never races the shared `PPEDetector`'s tracker state.

---

## 8. Detection & streaming pipeline

Under `backend/app/services/`. The historical ~2300-line `ppe_detector.py` is now a
thin re-export shim; real PPE logic lives in `ppe/`, and orchestration lives in
`video_pipeline/`, which is the **only** module permitted to import from both
`app.services.ppe` and `app.services.zone_service`.

### `ppe/` subpackage

- **`detector.py` — `PPEDetector`** loads the PPE model and an optional sign model.
  For the `/ws/stream` instance it maintains a pool of tracker-isolated model
  instances, because Ultralytics' `track(persist=True)` keeps tracker state on the
  model object, so concurrent streams cannot share one.
- **`response_builder.py`** turns raw YOLO boxes into the domain model: splits by
  class, assigns equipment to the best-overlapping person
  (`PPE_OVERLAP_THRESHOLD`, one item per person, highest confidence wins ties), infers
  role (**coverall → `janitor`**, vest → `worker`), computes compliance.
- **`violation_matching.py`** dedups: matches a new observation to an open case by
  track id, then IoU within a frame-gap window, then centre-distance fallback. A
  separate suppression pass stops a re-tracked worker generating a second row for the
  same real-world event.
- **`worker_tracking.py` — `WorkerState`** is the richest state machine in the PPE
  path. It gates "judgeability" (grace period after first seen, not near a frame edge,
  sufficient bbox height, no unclear posture like bending), debounces flicker, and
  requires a missing label to persist for `VIDEO_VIOLATION_CONFIRM_SECONDS` of
  consecutive frames before it is reportable. **Evidence counters are deliberately not
  reset when a worker becomes momentarily unjudgeable**, so transient tracking hiccups
  do not erase confirmed-but-unreported evidence.
  Role assignment is "sticky": once established it is reused even if the
  coverall or vest is not detected in a given frame.

### The model pool grows on demand

`MAX_CONCURRENT_STREAMS` (default **8**) was once the literal pool size, which made it
a number that had to be hand-raised for every camera added: too low and the extra
camera's stream silently retried forever behind a busy pool; high enough for future
cameras and every unused slot cost VRAM at boot.

It is now a **pure safety ceiling.** The pool tracks the ceiling (`_pool_size`)
separately from what exists (`_pool_created`) and grows in `_grow_pool()`. Raising it
reserves no VRAM. `MODEL_POOL_PREWARM` (default 3) is how many are built and warmed at
startup.

One instance is held per connected camera for the life of its WebSocket — every
*active* camera connects, whether or not its tile is on screen — so the ceiling is also
the maximum number of cameras that can stream at once.

### `video_pipeline/__init__.py` — the orchestrator

One ~1500-line async generator (`real_video_pipeline`) serving both uploaded-file batch
processing and live RTSP, branching on URL scheme. Live sources subscribe to the shared
`frame_hubs` registry — one decode per camera, shared by PPE preview, sign worker,
behaviour worker and the annotated compositor. Local files use Ultralytics'
`model.track(stream=True, persist=True)` directly.

- **Cadence gates** throttle PPE to `LIVE_PPE_TARGET_FPS` (8.0) and sign to
  `LIVE_SIGN_TARGET_FPS` (1.0), phase-offset by `LIVE_SIGN_PHASE_FRAME` so the two
  never compete for the same source frame.
- **Dynamic settings**: a shared dict mutated by the WebSocket listener is read every
  iteration. Toggles flip live; `viewing` gates whether preview JPEGs are produced at
  all, so an enabled-but-unwatched camera still runs detection and incident logic
  without the encode/send cost.
- **Zone incursion loop**: per tracked person, computes a foot point and tests it
  against every loaded polygon. `WALKWAY` accumulates dwell while **outside**;
  `RESTRICTED`/`SLIPPERY` while **inside**. **Dwell is credited per *processed* frame,
  not per *stride* frame** — a 1.5 s threshold was previously running at a third of
  real time on a 24 fps source.
- **Retroactive zone check**: keeps ~30 s of foot-position history per track. When zone
  monitoring is toggled on mid-stream, or zones are hot-reloaded, it replays that
  history against the newly-active zones using **max-continuous** dwell (not
  cumulative) and fires violations that would have fired had monitoring been on all
  along.
- A `"frame"` event is emitted even when PPE and zone are both off, so **behaviour-only
  cameras do not freeze on the last image.**

### `frame_hub.py` — shared capture, and the warm-start window

`CameraFrameHub` owns one capture thread per source, RTSP forced to TCP. It detects
discontinuities (PTS going backwards, or jumping forward by more than 12× the expected
interval) by rotating a `stream_epoch` UUID, so every temporal consumer discards stale
cross-epoch state instead of silently bridging a gap.

Two subscription policies: **`latest`** (size-1, drop-to-newest — PPE preview, sign)
and **`ordered`** (bounded FIFO, default 180 — behaviour, annotated publisher). On
ordered overflow **the whole queue is discarded** and the next packet is explicitly
marked with a gap, rather than consuming a reordered sequence.

**The reload black screen, and its fix.** The hub used to stop its capture the instant
its last subscriber left, and `AnnotatedStreamPublisher` tore down its
ffmpeg → MediaMTX → HLS chain with it. A page reload therefore paid a full RTSP
handshake plus an HLS cold start every time, during which the manifest 404s and the
player can only sit and retry.

Both now stay warm for a grace period and are reattached to by the next connection —
`FRAME_HUB_IDLE_GRACE_SECONDS` and `ANNOTATED_PUBLISHER_IDLE_GRACE_SECONDS`, both
**60 s**. At 8 s a slightly-slow reload still fell off the edge and paid a full cold
start. **Shutdown still tears everything down immediately**, so no ffmpeg is orphaned.

### Behaviour pipeline

- **`behavior_features.py`** — feature extraction matching the classifier's training
  contract exactly: a fixed **60-frame window at 24 FPS**, producing 141 features.
  `MIN_VALID_FRAME_RATIO` (0.70) is the share of the window that must carry a real
  pose. **A source slower than `CANONICAL_FPS` can never reach it**, because
  `accept_source_frame` pads the canonical timeline with missing samples, capping the
  ratio at `source_fps / CANONICAL_FPS`.
- **`fall_detector.py`** — lazily loads the pose model and the ExtraTrees classifier.
  `classify()` applies training-time transforms (clamps, sqrt, double-log) before
  `predict_proba`, expecting exactly 3 classes. `FallLiveSession` resamples each
  camera's native rate onto the canonical 24 FPS timeline using **capture/media
  timestamps, not wall clock**, so variable or dropped-frame RTSP delivery never
  distorts the speed-derived features. Short same-track pose gaps (≤8 samples) are
  linearly repaired when safe. Predictions run once a window fills, then every
  12-sample stride, smoothed over a 3-sample history, with a 10 s per-track cooldown.
- **`behavior_inference.py`** — micro-batches ready frames from **every** camera
  through one finite CUDA pose call (max batch 4) rather than one model per stream. GPU
  work runs under the shared priority lock; **CPU BoT-SORT tracker updates run outside
  it** via a small thread pool, because holding the GPU lock across CPU tracker work
  previously caused 500+ ms lock waits for unrelated PPE work.
- **`behavior_stream.py`** — the live counterpart: source → pose/ReID → classification
  → incident buffer, with no PPE, zone or WebSocket concerns. It warms up on `latest`
  frames before switching to `ordered` so it does not start already behind.

A source below the classifier's canonical FPS used to produce nothing with no error
anywhere. The reason is now surfaced on the worker, and the real loader exception is
carried rather than asserting a missing scikit-learn.

### GPU coordination

**`PriorityInferenceLock`** is a re-entrant, priority-ordered lock serialising short
CUDA launch sections across behaviour pose/ReID (priority 0, highest), PPE (1) and sign
(2). It enforces **deadline-aging anti-starvation**: priorities 1 and 2 have max-wait
budgets (40 ms / 500 ms), and once exceeded a waiter is promoted ahead of nominally
higher-priority waiters. Behaviour keeps priority under normal contention without
starving everything else indefinitely.

**`CadenceGate`** accepts the first available frame at or after each computed deadline,
rather than requiring an exact frame index — bounding worst-case staleness instead of
drifting when the pipeline falls behind.

### `annotated_stream.py` — the compositor

`AnnotatedStateStore` buffers pose, PPE and sign state independently, each toggleable
and **epoch-isolated** (any update from a different `stream_epoch` clears all buffers).
It synthesises short interpolated pose frames to smooth display even though behaviour
samples every Nth frame, applies bounded TTL staleness rules when composing an output
frame (8 frames for PPE, 3 s for signs), and falls back to drawing PPE-only shapes from
PPE boxes when behaviour is off, so PPE violations still render without a skeleton.

`AnnotatedStreamPublisher` paces publication to
`captured_monotonic + ANNOTATED_STREAM_DELAY_SECONDS`. **That 3-second buffer is the
intentional latency budget** letting AI overlays catch up to a frame before it is
published; 2 s was tried and found insufficient for the first 60-frame behaviour
window. It re-reads the feature-flag callback every frame, so toggling a model during a
live view changes the output without restarting the publisher. A module-level ownership
guard ensures only one publisher owns a given output URL.

`RawFramePublisher` spawns ffmpeg (auto-selecting `h264_nvenc`, else `libx264`),
restarting once on write failure and falling back to libx264 if NVENC fails.

### `stream_health.py`

Thread-safe in-memory rolling metrics keyed by a **hashed** source id with credentials
stripped from the label. Tracks capture cadence, per-model processed/dropped/gap counts,
preview delivery, HLS rebuffer and dropped-frame counts, and the full publisher metric
set. Named per-stage latency timings report last/mean/p50/p95/p99/max over a 60 s
window. This is the instrumentation that located a ~746 ms periodic delivery gap and
confirmed that narrowing the GPU critical section fixed avoidable PPE blocking.

---

## 9. Zones & auto-zone

- **`spatial.py`** — `is_point_in_polygon`, a boundary-inclusive
  `cv2.pointPolygonTest` wrapper.
- **`zone_service.py`** — forbidden from importing PPE code. `load_zones()` converts
  normalised 0–1 UI coordinates into a fixed 1000-unit integer space for precise
  testing. `get_person_foot_point()` uses the **bottom-centre of the bbox** as the feet
  proxy. `record_zone_violation()` builds a human label per type, draws the polygon and
  person box onto a snapshot, and persists. Any snapshot or DB failure is logged and
  swallowed rather than crashing the detection loop.

### IGNORE zones — an exclusion mask

The newest zone type and the one most likely to be missed, since the commit that added
it across 11 files was labelled only "[ADD] UI modifications".

An IGNORE zone is a region a camera can see but should not police: a doorway onto a
public walkway, a monitor showing footage of people, a reflective surface producing
phantom detections. Detections whose ground point falls inside one are **dropped before
anything is recorded**.

The test point is the bottom-centre of the box — where the person is standing, not
where their head is. Using the box centre would exclude anyone whose torso overlapped
the mask while their feet were outside it.

Three front-end rules differ from every other zone type (`useZoneDrawing.ts`):

- **Dwell threshold is 0**, not 1.5 s (or 3 s for `WALKWAY`) — an exclusion is
  immediate, since there is no violation to accumulate toward.
- **Default name is "Exclusion Zone"**, not `"<TYPE> Zone"`.
- **Overlap is allowed** with any other zone. Every other pair is kept disjoint; a mask
  is meaningless if it cannot be drawn on top of what it is masking.

IGNORE is always a *drawn* zone, never an AREA, so it never appears as an incident's
`area_zone_id`, and it is excluded from analytics.

### The janitor exemption

A person in a `cleaning_coverall` is `role="janitor"`, and janitors are exempt from
SLIPPERY-zone violations. The exemption was originally applied to the two paths that
*persist* a violation but **not** to the loop building the tracking-overlay payload — so
a janitor mopping a slippery area got a red box reading "Zone: Slippery area" for an
incident that was never recorded. It is now fixed at the single source in
`video_pipeline`, and because that overlay `zone_type` feeds both the server-drawn label
and the client-drawn one, no frontend change was needed.

RESTRICTED zones are untouched: janitors are still flagged there, and still flagged for
PPE they are genuinely missing.

### Auto-zone suggestions

`derive_zone_polygon` builds a rectangle on the floor below a detected sign.
**`SignZoneRegistry`** is a stationarity state machine: a sign must stay within
`AUTO_ZONE_MOVE_TOLERANCE` of its first-seen anchor for `AUTO_ZONE_STATIONARY_SECONDS`
(3 s) before a suggestion fires. A sign being *carried* keeps restarting its streak and
never confirms.

**Suggestions are decided from the saved zones, not from in-memory state.** The
registry used to die with the WebSocket and was never told when the user accepted or
deleted a zone, so it got this wrong in both directions: an accepted zone was
re-suggested once a looped video brought the sign back around, while a deleted zone
stayed suppressed for the rest of the connection. `auto_zone.is_already_zoned()` now
drops a suggestion when a zone of the same type already covers most of its footprint,
so both actions take effect on the next sign frame and survive a reconnect.
`dismissed` is tracked separately from `emitted`, so a dismissal stays final while a
covering zone merely *parks* the suggestion.

`SignPPERegistry` is a simpler hit counter for wall-mounted PPE signs, firing on the
first reliable detection.

> **Known gap:** both registries define an `ACCEPTED` terminal state that is never
> assigned — `accept()` only sets a generic `emitted=True` — so the backend cannot
> distinguish "operator accepted" from "operator dismissed" beyond both being terminal.

### Camera identity normalisation

`camera_identity.normalize_camera_source_key` canonicalises `localhost` and `::1` to
`127.0.0.1`, preserving port and userinfo, so one physical stream never becomes two
`Camera` rows.

Saving a zone used to match cameras on the **raw** `video_name` while every other
service normalised first, so a zone saved for `rtsp://localhost:8554/stream2` would not
find the camera at `rtsp://127.0.0.1:8554/stream2`, minting a duplicate row. The
sibling lookup had the same flaw with a quieter symptom (a spurious "Camera not
found"). Also fixed: clearing saved zones never sent `reload_zones`, so the running
pipeline kept enforcing deleted polygons until the next reconnect.

---

## 10. Incidents & analytics

- **`incident_service.py` — `UnifiedIncidentService`** is the single normalised read
  layer over all three categories, forbidden from importing detection internals. It
  fetches each category independently, batch-fetches behaviour evidence to avoid N+1,
  then filters, sorts and truncates — logging a warning whenever a category hit its own
  limit.
- **`incident_feed_service.py`** provides server-side pagination: one `UNION ALL` over
  a `(category, id, timestamp)` projection across the three tables, with
  `ORDER BY`/`LIMIT`/`OFFSET` applied to the union, then hydrating only that page's
  rows. **`id DESC` is part of the sort key** so same-timestamp bursts have a stable
  order instead of appearing on two pages or none.
- **`incident_filters.py`** expresses the severity rules as SQL so filtering happens
  **before** `LIMIT`/`OFFSET`. The old client-side approach filtered over the newest
  `FEED_LIMIT` rows, so selecting a zone whose incidents fell outside that window showed
  an empty feed while the chart still counted them.
- **`live_streams.py`** is a process-wide registry of sources currently streaming. It
  lives in services, not the router, so analytics can read live-stream state without
  importing a router. **In-process only** — see
  [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) §3.
- **`analytics_service.py`** aggregates **in Python, not SQL** — a deliberate tradeoff:
  normalising three differently-shaped tables in SQL `CASE` expressions would
  reintroduce exactly the drift risk `incident_normalization.py` exists to prevent. The
  per-zone breakdown is always computed over the full unfiltered set, so the zone chart
  shows all zones even when the request is zone-filtered. `ANALYTICS_LIMIT` (20000)
  bounds worst-case memory, silently dropping the oldest rows past the cap **with a
  logged warning**.

---

## 11. Reporting

`app/services/reporting/` is restricted by its own docstring to reading from
`analytics_service`, `incident_service`, two repositories and `evidence_storage` —
never detection internals.

- **`report_data.py`** assembles a `ReportData` dataclass, capped at
  `REPORT_MAX_INCIDENT_ROWS` (25), sorted by severity then recency.
- **`insights.py`** generates deterministic, **rule-based (no LLM)** bullets: trend
  direction, hotspot zone (≥30% share), dominant type (≥25%), critical-severity flag,
  severity shift, peak day, quiet zones, camera coverage, all-clear.
  `build_caveats()` separately flags data-quality issues.
- **`pdf_renderer.py`** is pure rendering with no I/O — the caller pre-fetches snapshot
  bytes, so it is fully unit-testable without a DB or MinIO. Vendored DejaVu Sans fonts
  for Unicode, falling back to Helvetica.
- **`email_sender.py`** is stdlib-only, building a
  `multipart/mixed(multipart/alternative)` message. **The attachment must come after
  the alternative body or Gmail hides the body text.** It never logs raw
  `SMTPAuthenticationError` text, since some servers echo credentials.
- **`report_service.py`** concurrently fetches up to `REPORT_MAX_SNAPSHOTS` (6)
  evidence images for Critical/High incidents, swallowing every failure so a missing
  thumbnail never fails the report. `validate_recipients()` enforces a cap, an
  email-shape regex, a header-injection guard and the allowlist — **this exists
  specifically because the endpoint has no authentication.**
- **`schedule.py`** is pure date math: monthly clamps `day_of_month` to 1–28 to avoid
  "day 31 skips February".
- **`schedule_service.py`** — on failure it does **not** stamp `last_sent_at`, so the
  next 15-minute tick retries rather than waiting a full period.

### EN/VI translation threads through four layers

"An i18n layer was added" undersells this. A `language: Language = "en"` parameter
threads through `report_data.py` → `insights.py` → `pdf_renderer.py` →
`email_sender.py`.

| Layer | Holds |
| --- | --- |
| `reporting/i18n.py` | Static `t(key, language)` table for headings, table headers, KPI labels, empty states |
| `reporting/insights.py` | Generated **sentences**. Kept out of `i18n.py` because these interpolate numbers and names and need real Vietnamese word order, not a swapped noun. |
| `pdf_renderer.py`, `report_data.py` | Single reused words (severity, category) get small report-local maps, because they reappear in table cells, chart legends and canvas-drawn text rather than as one-shot paragraphs |
| `reporting/email_sender.py` | Subject templates by language, and HTML body labels as placeholders — a template swap, not a per-language HTML rewrite |

**Deliberately not translated:** incident type labels, zone names and camera names —
they come from normalisation rules and user-configured data. An unknown key or unknown
language falls back to English rather than raising, so a missing translation degrades
gracefully instead of crashing PDF generation.

---

## 12. Storage

- **`evidence_storage.py`** — typed upload methods per category, each validating
  extension. Object keys are `<category>/YYYY/MM/DD/<uuid>.jpg`, all UTC.
  `get_object_url()` returns a **1-hour presigned GET URL**; the database stores only
  the object *key*, never the presigned URL, since it is short-lived.
- **Local vs MinIO**: `storage/snapshots` is a temporary staging area — the pipeline
  writes there first, uploads, then best-effort deletes the local copy. MinIO is the
  authoritative archive.

### `_ensure_bucket()` is memoized

It used to call `ensure_bucket_exists()` on **every** call, and `get_object_url()` calls
it once per object — so building the incident feed fired one `bucket_exists()`
round-trip per row:

> ~1.3 ms × 810 rows = **~1.1 s of pure network wait** on every analytics request.

The result is now memoized in a module-level `WeakKeyDictionary[Minio, set[str]]`, keyed
by client and bucket. A bucket that exists does not stop existing, so re-checking bought
nothing. Weak keys mean a client built for a test does not outlive the test, and a
recycled `id()` cannot be mistaken for a previously-checked client. Uploads still
surface a genuine outage, because `fput_object` fails on its own.

**Deleting an incident row does not delete its MinIO object**, except via the bulk
behaviour path. See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) §5.

---

## 13. Frontend

Next.js 16 App Router, two routes: `/` renders `DashboardShell`, and `/analytics` is a
standalone copy of `AnalyticsDashboard` dynamically imported with `ssr: false`.

### Navigation

`data.ts` lists **three** nav items: Camera Feeds, Live Incident Panel, Analytics. A
fourth view, `factory3d`, exists and is reachable via `?view=factory3d` but **is not in
the navigation** — only one of its three static zones is wired to a real camera.

`DashboardShell` syncs the active tab to `?view=` and keeps `CameraPanel` and
`AnalyticsDashboard` **always mounted**, merely CSS-hidden on other tabs, so WebSocket
connections and React Query polling survive tab switches.

### Key components

- **`CameraPanel`** — the most complex component: per-camera feature overrides
  (optimistic with rollback), unifying uploaded-file and live sources behind one
  `sourceKey`, zone drawing, auto-zone suggestions, camera lifecycle, matrix view vs
  single view, and the run/analyze flow which blocks on overlapping-zone conflicts.
- **`ll-hls-video.tsx`** — low-latency `hls.js` config (`liveSyncDuration` 2 s),
  native HLS fallback for Safari, retry on network error, media-error recovery. It
  guards playback resume against a hidden tab or a different fullscreen owner, reports
  metrics every second, and sizes an inner ratio-locked "stage" so zone overlays stay
  positioned through fullscreen transitions. Its manifest retry is an **escalating
  backoff from 150 ms**, reset on a successful parse — a flat 750 ms retry was slower
  to recover.
- **`video-tracking-overlay.tsx`** — selects the right overlay frame for the current
  playback moment via `stream-timeline.ts`, merges live behaviour detections by track
  id / IoU, and reports rendered-frame skew back for telemetry.
- **`incident-severity.ts`** — the client mirror of the backend severity rules, shared
  by incident cards, the detail modal and the filter chips so the three cannot drift.
- **`useModalDismiss.ts`** — the keyboard contract every modal owes its users: Escape
  closes, focus starts inside, Tab cannot walk out, focus returns to the opener. Both
  dialogs previously had `role="dialog"` and `aria-modal` but no Escape handler and no
  focus management, so the only way out was clicking the backdrop — which stranded
  keyboard users while Tab quietly walked the page behind the overlay.
- **`confirm-delete-all-dialog.tsx`** — replaces a bare `window.confirm` for "delete
  every logged incident". It requires typing `DELETE` and states the record count. The
  browser's default dialog put its confirm button under the cursor, so a mis-aimed
  double-click near Refresh was two clicks from an empty incident store.

### `stream-timeline.ts` — never paint the future

`selectOverlayAtTime` chooses which box to render at the current playback instant:
exact match if available, a short bounded "hold" of a slightly-stale box, or linear
interpolation between surrounding samples (capped at 8 frames of span) — **or it drops
the box rather than ever painting a future detection on an earlier frame.** It returns
diagnostics used both for an "AI delayed" indicator and reported back to the backend.

### The KPI row never invents a number

Three deliberate choices in `useSafetyKpis.ts`:

- **`pending` replaces `?? 0`.** No summary yet means the numbers are *unknown*, not
  zero. The old fallback rendered **"0 Open Incidents"** for the seconds before the
  first response landed — a specific, believable, wrong number on a safety readout. A
  *refetch* failure keeps the last good numbers, since the 5 s poll means one dropped
  request should not blank the row, but a cold failure with nothing cached stays pending
  rather than inventing zeros.
- **`placeholderData: keepPreviousData`.** `zoneId` is part of the query key, so
  selecting a zone started a new query and `data` dropped to `undefined`. Zone Pulse
  builds its nodes from `summary.zone_totals`, so that blanked and rebuilt the whole
  chart on every click — read as lag even once the request was fast.
- **Active Cameras reads `live_cameras`, not `active_cameras`.** The historical figure
  stayed high for days after a camera stopped streaming and shifted when you changed
  the range.

**PPE Compliance and People On Shift were removed**, not left as placeholders. They had
no data source and sat as permanent `—`, so half the most valuable strip answered
nothing and pushed the two real metrics to the edges.

### Design system

Colour semantics collapse to exactly four states used identically everywhere:
**Suggestion** (sky), **Pending** (amber), **Active** (lime, the brand accent),
**Violation** (red). Geist Mono is used specifically for scannable numerals. Motion is
deliberately minimal — one 160 ms transition, `prefers-reduced-motion`-aware.
`DetectionChip` is the app's one signature element: every "the model noticed something,
your move" surface is built from it, so they read as one visual system.

---

## 14. Local infrastructure

- **`docker-compose.yml`** — three services, **no backend container** (the backend runs
  natively): `mediamtx` (RTSP 8554, HLS 8888), `postgres:16` (host port 5433), `minio`
  (API 9000, console 9011).
- **`mediamtx.yml`** — RTSP TCP-only, LL-HLS with low-latency tuning
  (`hlsVariant: lowLatency`, 1 s segments, 200 ms parts). WebRTC/RTMP/SRT disabled.
  Paths exist only while something is publishing.
- **`scripts/publish-rtsp.ps1`** — loop-publishes a local video file as RTSP to
  simulate a camera. Normalises to **CFR 24 FPS, H.264, 1 s GOP, no B-frames**, matching
  the backend's 24 FPS behaviour assumption and letting LL-HLS emit independently
  decodable one-second segments.

## 15. Scripts

| Script | Purpose |
| --- | --- |
| `verify_weights.py` | Checks weights presence and checksums against `weights/MANIFEST.json` |
| `generate_docs.py` | Regenerates CONFIGURATION.md, API.md and DATABASE.md from the code |
| `add_incident_area_zone.py` | Adds and backfills `area_zone_id` on all three incident tables |
| `backfill_zone_violation_severity.py` | Fills historical `NULL` zone severities |
| `add_report_language_column.py` | Adds `report_schedules.language` |
| `apply_new_indexes.py` | Creates any missing indexes on an existing database |
| `export_tensorrt.py` | Builds FP16 TensorRT engines from the `.pt` weights |
| `check_gpu_runtime.py` | Diagnostic: torch/CUDA info and whether the detector loaded on GPU |
| `check_model.py` | Smoke test: loads the detector, runs one dummy prediction |
| `reset_db.py` | **Destructive**: drops and recreates every table |
| `benchmark_llhls.py`, `benchmark_streams.py` | Latency and cadence benchmarks |
| `probe_stream_timing.py`, `probe_ws_timing.py` | Isolate whether lag is at the source or in the backend |
| `test_sign_detection.py`, `test_ws.py` | Manual smoke tests, **not** pytest suites despite the names |

## 16. Corrections to the superseded documents

Recorded because both documents are archived rather than deleted, and someone will read
them.

| Claim | Where | Reality |
| --- | --- | --- |
| `FALL_BEHAVIOR_MODEL_PATH` default renamed `best_behavior_model.joblib` → `behavior.joblib` | CHANGES §7 | **Backwards.** `de167f9` changed it the other way, and that commit predates the document's stated range. `config.py` has always defaulted to `best_behavior_model.joblib` since then. |
| `FALL_BEHAVIOR_MIN_CONFIDENCE` moved 0.50 → 0.70 | CHANGES §4 | `config.py` still defaults to **0.50**. It is `backend/.env.example` and the local `.env` that carry 0.70. |
| `PPEDetector.predict()`'s missing `_real_predict` is "unexercised" dead code | OVERVIEW §24 | `POST /predict` calls it (`detection.py:73`), so that endpoint returns **500**. Verified empirically. |
| Two KPI tiles are placeholders rendering `"—"` | OVERVIEW §20, §24 | They were **removed**, not left in place. |
| `MAX_CONCURRENT_STREAMS` is the pool size, default 1 | OVERVIEW §4, §9 | Now a pure ceiling, default **8**; the pool grows on demand. |
| Orphaned MinIO objects on delete | handover plan | True except for the **bulk behaviour** delete path, which does clean up. |
| 3D Map route works but is hidden from nav | OVERVIEW §16 | Still true. Confirmed: `data.ts` lists three items. |
| `backend/docs/api_routes.md` and `database_schema.dbml` are stale | OVERVIEW §24 | Still true. Superseded by the generated [API.md](./API.md) and [DATABASE.md](./DATABASE.md). |
