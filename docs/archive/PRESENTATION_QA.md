> # ⚠️ HISTORICAL — PRESENTATION PREP, NOT DOCUMENTATION
>
> Speaker notes prepared for the capstone presentation, kept because the reasoning
> in them is genuine and occasionally explains *why* something is built the way it
> is. **It was written to be spoken, not to be relied on.**
>
> Two cautions:
>
> - It was grounded in the code at `950e09c` **and in a local `backend/.env`**, so
>   some figures reflect that machine's configuration rather than the code defaults.
> - It is framed around defending the project to an audience, including a "hostile
>   questions" section and a "demo safety net". That framing is not a neutral
>   description of the system.
>
> For current, verified documentation see [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md),
> [`docs/KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md) and
> [`docs/MODELS.md`](../MODELS.md). Where this file and those disagree, **those are
> correct** — they were re-verified against the code during the handover.

# Presentation Q&A Prep — De Heus Smart Factory Safety Monitor

Prep notes for the upcoming presentation. Every answer below is grounded in the
current code on `develop` (`950e09c`) and the live `backend/.env`, not in the
older planning docs. Where the repo has a real gap, it is marked
**WEAK SPOT** with advice on how to answer honestly.

Use the [Numbers cheat sheet](#14-numbers-cheat-sheet) as the last thing you read
before walking in.

---

## Table of contents

1. [The 60-second pitch](#1-the-60-second-pitch)
2. [Scope & business value](#2-scope--business-value)
3. [PPE detection](#3-ppe-detection)
4. [Behavior / fall detection](#4-behavior--fall-detection)
5. [Zones & auto-zone from safety signs](#5-zones--auto-zone-from-safety-signs)
6. [Architecture & real-time streaming](#6-architecture--real-time-streaming)
7. [Accuracy, false positives, trust](#7-accuracy-false-positives-trust)
8. [Data, evidence & storage](#8-data-evidence--storage)
9. [Analytics & reporting](#9-analytics--reporting)
10. [Performance & scalability](#10-performance--scalability)
11. [Security, privacy & ethics](#11-security-privacy--ethics)
12. [Deployment & operations](#12-deployment--operations)
13. [Limitations & roadmap](#13-limitations--roadmap)
14. [Numbers cheat sheet](#14-numbers-cheat-sheet)
15. [Hostile / hard questions](#15-hostile--hard-questions)
16. [Demo safety net](#16-demo-safety-net)

---

## 1. The 60-second pitch

**Q: What is this system, in one sentence?**

A camera-based safety monitoring system for De Heus factories: it watches live
RTSP camera feeds and automatically detects three classes of safety problem —
missing PPE (helmet / vest / cleaning coverall), people entering or leaving zones
they shouldn't (restricted areas, slippery areas, walkways), and dangerous
behavior (falling, running) — then records each event with a photo snapshot,
shows it live to an operator, and rolls it all up into analytics and a PDF safety
report that can be emailed on a schedule.

**Q: What makes it different from a generic "PPE detector" demo?**

Three things:

1. **It doesn't just detect, it decides.** A raw detector fires on every frame.
   This system has a confirmation state machine: grace periods for newly-tracked
   people, judgeability gates (too small, too close to the frame edge, unclear
   posture = no verdict), flicker debouncing, and a requirement that a missing
   item persist for 0.75s of consecutive frames before it becomes a violation.
   Then a dedup layer prevents the same real-world event being recorded twice
   when tracking breaks.
2. **The video the operator sees is the video the AI saw.** Overlays are burned
   onto frames server-side and republished as a second stream, so geometry,
   labels and pixels share one clock. No browser-side box layer racing the video.
3. **It configures itself from the factory's own signage.** Point a camera at a
   "slippery floor" sign that has been put down and left in place, and the system
   proposes the monitored zone for it.

---

## 2. Scope & business value

**Q: What problem does this solve for De Heus?**

Safety supervision today is human and sampled — a supervisor walks the floor and
sees a slice of the shift. This makes it continuous and evidential: every
incursion or missing helmet gets a timestamp, a camera, a zone and a photo, so
the weekly safety meeting argues about data instead of impressions, and a
repeated hotspot becomes visible instead of anecdotal.

**Q: Who are the users?**

Two roles, one UI today: the **operator / control-room** view (Camera Feeds +
live Incident Log) and the **safety manager** view (Incident Analytics, PDF
export, scheduled email report). Both live in the same Next.js dashboard as tabs.

**Q: Is this meant to punish workers?**

No, and that framing matters for adoption. The system records events, not people
— there is no identity, no face recognition, no per-worker history. Tracking IDs
are per-session and meaningless across reconnects. The reporting layer aggregates
by **zone**, not by person, which is deliberate: the output is "the packing area
produced 40% of this week's incursions", not "worker X was flagged 7 times".

**Q: What is explicitly out of scope?**

Fire/smoke, machine guarding, forklift proximity, gas sensors, access control,
and attendance. Also: no worker identification, and no automatic intervention —
the system reports, it does not stop machinery or open/close doors.

---

## 3. PPE detection

**Q: What PPE does it actually detect?**

The PPE model (`ppe_v4`) detects persons plus four equipment classes:
`Helmet`, `Vest`, `Cleaning Coverall`, `Role Uniform`. From these it infers a
**role**: a cleaning coverall means `janitor`, a vest means `worker`, neither
means the person is a violation by itself. Required-equipment logic then differs
by role, which is why a janitor mopping is not treated like a production worker.

**Q: How does it know which helmet belongs to which person?**

Geometric assignment, not a second model. Every equipment box is matched to the
person box it overlaps most, gated by `PPE_OVERLAP_THRESHOLD = 0.3` (overlap
ratio against the equipment box). One item per person; on ties the higher
confidence wins. That's in `ppe/response_builder.py`.

**Q: Why not train one end-to-end "compliant / non-compliant person" classifier?**

Because it would be unexplainable and unmaintainable. With separate classes the
system can say *which* item is missing, show it in the snapshot, and let you add
a new PPE type by retraining one detector rather than relabelling every person in
the dataset. It also lets the role logic be a readable rule instead of a
black box.

**Q: Someone turns their back / walks behind a pallet. Do you fire a false violation?**

That's exactly what the judgeability gates exist for. A person is only judged if
they are past a 0.5s grace period after first being tracked, not within 5% of the
frame edge, at least 10% of frame height tall, and not in an "unclear posture"
(bending/crouching, detected via a 70% height-drop heuristic over a short
posture history). If any gate fails, the frame produces **no verdict** — not a
violation. Crucially, the already-accumulated evidence counters are *not* reset
when someone becomes momentarily unjudgeable; that was a deliberate fix so a
tracking hiccup can't erase confirmed evidence.

**Q: The helmet flickers out for two frames. Violation?**

No. Two layers stop that: a label seen compliant within
`VIDEO_RECENT_PPE_MEMORY_SECONDS = 1.5s` suppresses a momentary miss, and a
missing label must persist for `VIDEO_VIOLATION_CONFIRM_SECONDS = 0.75s` of
consecutive frames before it is even *eligible* to be reported.

**Q: The same worker gets re-tracked with a new ID. Two violations?**

No. `ppe/violation_matching.py` matches a new observation to an existing open
case by track ID first, then by IoU within a 90-frame gap window, then by
center-distance as a fallback; a separate suppression pass (300 frames) catches
the case where track continuity was fully lost. And `worker_tracking.py` prefers
matching against *already-reported* workers spatially, precisely so a worker who
lost tracking after being flagged isn't flagged again.

**Q: Why is PPE only inferred at 8 FPS when the camera runs at 24?**

Because PPE compliance is a slowly-changing property — a helmet doesn't appear
and disappear in 40ms — while GPU time is scarce and shared with the pose
pipeline, which *does* need every frame. `LIVE_PPE_TARGET_FPS = 8` buys back
two-thirds of the GPU budget for behavior detection with no loss of PPE recall,
because the 0.75s confirmation window spans ~6 PPE samples anyway.

---

## 4. Behavior / fall detection

**Q: How does fall detection work? Is it a video model?**

No — it's a two-stage, deliberately cheap pipeline:

1. **YOLO pose** runs on every frame, giving skeleton keypoints per person,
   tracked with BoT-SORT + a ReID embedding model so identities survive short
   occlusions.
2. Per track, keypoints are resampled onto a **canonical 24 FPS timeline** and
   buffered into a **60-frame (2.5s) window**. From that window
   `behavior_features.py` computes hand-engineered features — torso angle, body
   "compression" (head-to-hip over height), spread ratio, ground point, body
   size, plus frame-to-frame speed deltas — summarized into stats, strided
   samples and final-state heuristics.
3. An **ExtraTrees classifier** (scikit-learn, CPU) predicts one of three classes:
   `others` / `running` / `falling`.

**Q: Why a classical classifier instead of a deep video model (3D CNN, transformer)?**

Four reasons, and this is a good question to have a crisp answer for:

- **GPU budget.** The pose model already occupies the GPU for every frame on
  every camera. A video model would be a second per-frame GPU consumer; the
  ExtraTrees runs on CPU, effectively free, and scales to more cameras without
  more VRAM.
- **Data.** A 3D CNN needs far more labelled falling footage than a factory
  safety project can realistically collect. Features over pose keypoints
  generalize from a much smaller dataset.
- **Invariance for free.** Working on normalized skeletons rather than pixels
  makes it largely indifferent to clothing, lighting and camera colour response.
- **Explainability.** When it misfires you can look at the feature vector — torso
  angle, compression, speed — and say *why*. That matters for a safety system
  someone has to trust.

**Q: Why exactly 60 frames at 24 FPS? Why not just use whatever the camera gives you?**

Because the feature contract is trained at that cadence and several features are
*speed* derivatives — they are only meaningful if the sample interval is fixed.
A 60-sample window at 24 FPS is 2.5s, which is long enough to contain an entire
fall (stumble → descent → ground) rather than one ambiguous instant. This is also
why `FALL_LIVE_FRAME_STRIDE` is hard-validated to 1 in config: setting it to 2
would silently turn a 2.5s window into 5s and invalidate the classifier.
`FallLiveSession` resamples each camera's native rate onto that timeline using
capture/media timestamps, **not wall clock**, so a variable-rate RTSP feed never
distorts speed features.

**Q: What happens when frames are dropped or a person is briefly occluded?**

Short same-track pose gaps of up to 8 samples are linearly interpolated, and only
if the repair looks safe (confidence and center-shift checks). Each window also
carries a data-quality metric: if fewer than 70% of frames are valid
(`valid_frame_ratio < 0.70`) the window is not treated as good quality. On a
**source discontinuity** — PTS going backward, or a forward jump over 12x the
expected interval — the frame hub rotates a `stream_epoch` UUID and every
temporal consumer throws away its state instead of silently bridging the gap and
classifying a sequence that never physically happened.

**Q: How do you avoid alert spam from one fall?**

Predictions only run once a window is full, then every 12 samples (0.5s); the
probabilities are smoothed over a 3-sample history; an incident is only persisted
on a **label transition** into `running`/`falling` above
`FALL_BEHAVIOR_MIN_CONFIDENCE = 0.70`; and there is a **10-second per-track
cooldown** on top.

**Q: You show "Behavior: Unknown" on some people. Isn't that a bug?**

No, it's an honesty fix. A track needs 60 samples — 2.5s of unbroken tracking
under one track ID — before any verdict exists, and a tracker ID switch restarts
that from zero. So a person sprinting across the frame is simultaneously the most
important case and the least likely to be assessed yet. Previously the UI fell
through to "Compliant" for them, which vouched for something the model had never
evaluated. Now "not assessed" and "assessed as normal" are visibly different
states, and the Unknown label composes with a PPE or zone finding rather than
replacing it.

**Q: Your enum has FAINT_DETECTED and COLLAPSE_DETECTED. Do those work?**

Not today — be upfront about this. They are forward-provisioned labels in the
schema; the live classifier has exactly 3 classes, so only `FALL_DETECTED` and
`RUNNING_DETECTED` are ever persisted. The columns exist so adding a class later
needs no schema migration.

**Q: Why is running a violation at all?**

In a feed-mill environment running is a leading indicator: it's either a person
in a hurry near moving equipment, or a person reacting to something that has
already gone wrong. It's recorded at lower severity than a fall, as a pattern
signal for the safety manager rather than an emergency.

---

## 5. Zones & auto-zone from safety signs

**Q: What zone types are there?**

Four *drawn* zone types plus one non-drawn:

| Type | Fires when | Notes |
|---|---|---|
| `RESTRICTED` | person is **inside** for longer than the dwell threshold | the classic keep-out area |
| `SLIPPERY` | person is **inside** past dwell | **janitors exempt** — they're the ones cleaning it |
| `WALKWAY` | person is **outside** past dwell | inverted logic: the violation is *leaving* the safe path |
| `IGNORE` | never fires | an exclusion mask — see below |
| `AREA` | not drawn, never fires | a coarse factory area used only for analytics grouping and a camera's "home zone" |

**Q: What is an IGNORE zone for?**

It's an exclusion mask for regions a camera can see but should not police: a
doorway onto a public corridor, a monitor that is itself showing footage of
people, a reflective surface that generates phantom detections. Any detection
whose ground point falls inside one is dropped *before* anything is recorded. It
has three deliberately different UI rules from every other zone: dwell is 0 (an
exclusion is immediate), it defaults to the name "Exclusion Zone", and it is the
only zone type allowed to **overlap** others — a mask is useless if you can't
draw it on top of what it masks.

**Q: How do you decide a person is "in" a zone — by their box?**

By their **feet**: the bottom-center point of the bounding box. Using the box
center would flag anyone whose torso leaned over a boundary line while they were
standing safely outside it, and would mis-handle overhead camera angles. Polygon
tests run in a fixed 1000-unit integer coordinate space via
`cv2.pointPolygonTest`, converted from the normalized 0-1 coordinates the UI
stores, so geometry is resolution-independent.

**Q: Dwell thresholds — why not fire instantly on entry?**

Because someone stepping over a line while turning around is not an incursion.
Dwell is per-zone configurable (`dwell_threshold_seconds`), and it is credited
per **processed** frame rather than per stride frame — a bug worth mentioning if
asked about testing rigor: with stride-based crediting a 1.5s threshold was
effectively running at a third of real time on a 24 FPS source.

**Q: The operator turns zone monitoring on mid-shift. Do you lose what just happened?**

No — there's a retroactive check. The pipeline keeps a rolling ~30 second history
of foot positions per track. When zone monitoring is toggled on, or zones are
hot-reloaded, that history is replayed against the newly-active zones using
**max-continuous** dwell (not cumulative, so two brief passes don't add up to a
violation), and any violation that *would* have fired is fired. Then that
worker's zone state resets so live tracking continues cleanly.

**Q: Explain the auto-zone feature — the system draws its own zones?**

It *proposes* them; a human accepts. A separate sign-detection model watches for
safety signage. `SIGN_CLASS_ZONE_MAP` maps sign class 2 → `RESTRICTED` and class
3 → `SLIPPERY`. When such a sign is seen, `derive_zone_polygon` builds a
rectangle on the floor below it (horizontally centered, extending down from the
sign's bottom edge — that's the area the sign is *about*), and a suggestion chip
appears on the feed for the operator to accept, adjust or dismiss.

**Q: What stops a worker *carrying* a sign from creating zones all over the factory?**

A stationarity state machine (`SignZoneRegistry`). A sign must stay within a small
position tolerance of where it was first seen for
`AUTO_ZONE_STATIONARY_SECONDS = 3.0` before a suggestion fires. A carried sign
keeps restarting its still-streak and never confirms; only a sign that has been
**put down and left** does.

**Q: Does an accepted suggestion come back and nag you again?**

Not anymore — this was a real bug worth telling as a story. Suggestions used to
be decided from in-memory state that died with the WebSocket and never learned
what the user did. It failed in both directions: an accepted zone got
re-suggested once a looped video brought the sign around again (the emitted track
is pruned after ~6s off-screen and a drifting center mints a new suggestion ID),
while a *deleted* zone stayed suppressed for the rest of the connection.
Suggestions are now decided from the **saved zones** — dropped if a zone of the
same type already covers most of the suggestion's footprint — so both actions
take effect on the next sign frame and survive a reconnect. "Dismissed" is
tracked separately from "parked behind an existing zone", so a dismissal stays
final.

**Q: Why do wall-mounted PPE signs behave differently from zone signs?**

Because they mean something different. A hard-hat or vest sign
(`SIGN_CLASS_PPE_TRIGGER = {0, 1}`) is bolted to a wall and declares a rule for
the area; there's nothing to wait for, so it fires on the first reliable
detection (`AUTO_PPE_CONFIRM_FRAMES = 1`). A slippery-floor sign is a portable
object whose *position* is the information, so it must prove it's stationary.

---

## 6. Architecture & real-time streaming

**Q: Walk me through the architecture.**

```
RTSP camera ──► CameraFrameHub (ONE decode per camera, shared)
                   │  "latest" subs          "ordered" subs
                   ├──────────────┬───────────────┬──────────────┐
                   ▼              ▼               ▼              ▼
              PPE detector    Sign worker    Behavior worker   Annotated
              (YOLO+track)    (YOLO sign)    (pose + ReID +    compositor
                   │              │           ExtraTrees)          │
                   └──────┬───────┴───────────────┘                │
                          ▼                                        │
                 video_pipeline (orchestrator: PPE+zone+sign+behavior)
                          │                                        │
          PPEViolation / ZoneViolation / BehaviorIncident      FFmpeg → MediaMTX
             (Postgres rows + MinIO snapshots)                  (_annotated LL-HLS)
                          │                                        │
              UnifiedIncidentService / AnalyticsService             │
                          │                                        │
                    FastAPI REST  ◄── WebSocket /ws/stream ────────┘
                          │                    │
                          ▼                    ▼
                    Next.js dashboard (plays annotated LL-HLS + JSON events)
```

Backend: FastAPI + SQLModel, PostgreSQL, MinIO, Ultralytics YOLO, FFmpeg,
MediaMTX. Frontend: Next.js 16 / React 19 / TypeScript, hls.js, React Query,
recharts, three.js.

**Q: Why is there a shared "frame hub" instead of each model opening the camera?**

Because four consumers need the same camera and RTSP decode is expensive. One
capture thread per source (RTSP forced to TCP) feeds everyone, with two
subscription policies matched to each consumer's needs:

- **`latest`** — a size-1 drop-to-newest slot, for consumers that only care about
  *now*: the PPE preview and the sign worker. Stale frames are worthless to them.
- **`ordered`** — a bounded FIFO (180 frames) for consumers that need an unbroken
  sequence: behavior classification and the annotated publisher. On overflow the
  **entire queue is discarded** and the next packet is explicitly marked as a
  gap, rather than quietly handing the classifier a non-consecutive sequence.

The registry also stops and evicts a hub once its last subscriber leaves (after a
grace period), so an unwatched camera isn't burning CPU decoding into a void.

**Q: Why burn overlays server-side instead of drawing boxes in the browser?**

This is the most interesting architectural decision in the project. The original
design streamed raw video to the browser and drew a separate SVG box layer on top,
synced by wall-clock time. It was never stable: the video element, the HLS buffer,
and the WebSocket event stream are three independent clocks, so boxes lagged,
led, or jittered relative to the people they described — and on a safety system,
a box on the wrong person is worse than no box.

Now the backend composes pose skeletons, PPE labels, zone labels and sign
annotations directly onto the frame and republishes it via FFmpeg to MediaMTX as
a second RTSP path (`..._annotated`), served as LL-HLS. Pixels and geometry share
one frame clock by construction. The dashboard plays only that stream.

**Q: You add 3 seconds of latency on purpose. Defend that.**

`ANNOTATED_STREAM_DELAY_SECONDS = 3.0` is a deliberate latency budget: it's the
time the AI needs to catch up to a frame before that frame is published. The
binding constraint is behavior detection — the first verdict needs a full 60-frame
window, i.e. 2.5 seconds. A 2s delay was tried and found insufficient.

The trade is correct for this use case: this is a **supervisory** system, not a
control loop. Nobody's hand is in a press waiting on it. An operator seeing a
correctly-annotated frame 3 seconds late is strictly more useful than seeing an
unannotated or wrongly-annotated frame instantly. And for evidence — the actual
output — latency is irrelevant; every row is timestamped from capture, not from
display.

**Q: What actually goes over the WebSocket, then?**

Structured events, not live video: `violation`, `zone_violation`,
`behavior_incident`, `zone_suggestion`, `ppe_suggestion`, `sign_prediction`,
`summary`, `start`/`end`, `error`. Each carries timeline metadata
(`frame_index`, `stream_epoch`, `media_pts_ms`, `source_time_ms`,
`inference_completed_ms`, `discontinuity_sequence`) so independently-cadenced PPE,
sign and behavior results can be correlated back to a physical frame. Raw JPEG
preview frames are only sent for *uploaded-file* playback, and they're sent as
binary WebSocket frames — never base64 inside JSON, which would inflate them
by a third.

The socket also has a reliability split: `frame` events coalesce to a single
latest-only slot (drops are counted), while every other event type goes on an
unbounded FIFO that is never dropped. Losing a preview frame is cosmetic; losing
a violation is data loss.

**Q: Two browser tabs open the same camera. What happens?**

A per-source `asyncio.Lock` serializes connections (a new client waits up to 12s),
and a cancel event lets a newer connection **supersede** an orphaned one: the old
socket is closed with code **4001**, and the frontend is built to not auto-reconnect
on that specific code. This exists because browser reloads and React StrictMode
double-mounts leak sockets that never send a close frame. Teardown also fully
closes the generator before releasing the lock, so the next connection can't race
the previous one's tracker state.

**Q: Why did a page reload used to show a black screen?**

Because the frame hub used to stop its capture the instant the last subscriber
left, and the annotated publisher tore down its ffmpeg → MediaMTX → HLS chain with
it. A reload then paid a full RTSP handshake plus an HLS cold start, during which
the manifest legitimately 404s and the player can only retry. Both now stay warm
for `FRAME_HUB_IDLE_GRACE_SECONDS = 60` / `ANNOTATED_PUBLISHER_IDLE_GRACE_SECONDS
= 60` and the next connection reattaches. Shutdown still tears everything down
immediately, so no ffmpeg process is ever orphaned. (An 8-second grace was tried
first — a slightly slow reload still fell off the edge.)

**Q: Three models want the GPU at once. How do you arbitrate?**

A `PriorityInferenceLock` serializes the short CUDA launch sections:
behavior pose/ReID is priority 0 (highest, because it's the only consumer that
needs *every* frame), PPE is 1, sign is 2. To stop the low-priority work
starving, waiters have max-wait budgets (40ms for PPE, 500ms for sign); once a
budget is exceeded the waiter is **promoted ahead** of nominally higher-priority
work. Separately, CPU BoT-SORT tracker updates were deliberately moved *outside*
the lock — holding the GPU lock across CPU tracker work had been causing 500ms+
lock waits for unrelated PPE inference.

**Q: Did that ever go wrong?**

Yes, and the fix is a good engineering-maturity story. Whether a waiter is "next"
depends on the clock as well as the waiter set — a ticket becomes overdue simply
because its deadline passed, with no state change and therefore no `notify_all()`.
Waiters only re-checked when notified, and notification only came from `release()`,
so on an *idle* lock a newly-designated waiter could sleep through its turn
forever. Every GPU consumer parked at once with the lock unowned, and the
annotated stream kept publishing frames with nothing drawn on them. Fix: waiters
now park with a timeout derived from the nearest waiter deadline (capped at 50ms,
never 0), and `acquire()` notifies whenever a ticket joins — so a missed wake
costs one tick instead of a permanent freeze. It has a named regression test.

---

## 7. Accuracy, false positives, trust

**Q: What is the accuracy of your models?** — **WEAK SPOT**

**Do not improvise a number here.** The repository contains no committed
evaluation report — no mAP, precision/recall or confusion matrix for the PPE,
pose, sign or behavior models. Before the presentation, either:

- pull the real metrics from your training runs (Ultralytics writes
  `results.csv` / `confusion_matrix.png` per run; scikit-learn gives you a
  classification report for the ExtraTrees), and put them on a slide; **or**
- answer honestly: *"Component-level metrics live with the training runs rather
  than in this repo; what I can show you is the end-to-end behavior on held-out
  footage, and the system-level controls that determine how many alerts an
  operator actually sees."* Then pivot to the confirmation logic below.

Having one real number per model is worth more than any other slide you could
add. This is the single most likely question.

**Q: How do you keep false positives manageable?**

Layered, and worth enumerating because it's the real engineering:

- **Confidence floors** — `CONFIDENCE_THRESHOLD = 0.5` for PPE detection,
  `SIGN_CONFIDENCE_THRESHOLD = 0.35`, `FALL_BEHAVIOR_MIN_CONFIDENCE = 0.70`.
- **Judgeability gates** — no verdict for people too small, too close to the
  frame edge, newly tracked, or in unclear posture.
- **Temporal confirmation** — 0.75s of consecutive frames for PPE; a full 2.5s
  window plus a smoothed 3-sample probability history plus a label *transition*
  for behavior; per-zone dwell thresholds for zones.
- **Deduplication** — track-ID → IoU → center-distance matching so one real event
  is one row.
- **Cooldowns** — 10s per track for behavior incidents.
- **Spatial exclusion** — IGNORE zones remove known phantom-detection regions
  (mirrors, monitors, doorways to public areas) entirely.
- **Role exemptions** — janitors aren't flagged in slippery zones they're cleaning.

**Q: And false negatives — what do you miss?**

Be candid: heavy occlusion (a person mostly behind machinery yields no reliable
pose), very small/distant people (below the 10% frame-height gate they're
deliberately unjudged), unusual camera angles far from the training distribution,
and any fall completed inside the first 2.5 seconds of a person being tracked,
since no window exists yet. A tracker ID switch mid-fall also restarts the window.

**Q: Show me a case where a tuning decision was driven by measurement, not guesswork.**

Pose input resolution. At 448px, YOLO-pose saw a fallen person in only **47 of
121 frames** of the test clip `falling_long.mp4` — and nothing at all during the
fall itself, so no track ever survived long enough to fill a 60-sample window:
the fall was invisible. At 640px it's **112 of 121** frames and every window
scores `valid_frame_ratio = 1.00`. That costs about 6ms/frame, and
`BEHAVIOR_POSE_IMGSZ=640` is set in `.env` with that measurement written in as a
comment.

**Q: How do you handle a wrong alert operationally?**

The incident detail modal has a "mark as false positive" action, and behavior
incidents carry a status enum (`NEW` / `REVIEWED` / `RESOLVED` /
`FALSE_POSITIVE`). Be honest about the current limit: that's a review workflow,
not a feedback loop — nothing yet feeds those labels back into retraining. It is
however exactly the dataset you'd want for the next training round.

**Q: There was a banner saying "Behavior detection unavailable" while falls were being detected. What was that?**

A trust bug, fixed. The worker was reporting a *startup projection* — raw source
rate versus the canonical timeline — as a user-facing unavailability banner. But
that ratio is window quality *before* pose-gap repair, and the classifier gates
on the repaired ratio. So a 15 FPS demo stream projected 62% against a 70% gate
while classifying continuously at 24 Hz with 22% of samples interpolated. The
banner contradicted the falls visible on the same screen. Worse, it was evaluated
once at construction and never re-checked, so it outlived its own condition.

It's now a log line only, and `unavailable` is reserved for hard failures where
the worker loop is actually dead. The reasoning is the point: an operator who
learns to disbelieve one banner discounts the next one too, so a noisy warning
actively damages the warning that matters.

---

## 8. Data, evidence & storage

**Q: Where does data live and why two stores?**

PostgreSQL holds structured incidents; MinIO (S3-compatible) holds the evidence
JPEGs and archived PDFs. Splitting them is standard practice: binary blobs bloat
database backups and destroy restore times, while object storage is cheap,
independently scalable, and directly swappable for real S3 in production. Postgres
stores only the **object key** — never a presigned URL, because those expire in
an hour.

**Q: What's the snapshot lifecycle?**

The pipeline writes the annotated snapshot to local `storage/snapshots` first
(fast, no network in the detection loop), uploads it to MinIO under
`<category>/YYYY/MM/DD/<uuid>.jpg`, then best-effort deletes the local copy. MinIO
is authoritative. Reads go through a 1-hour presigned GET URL.

**Q: Does deleting an incident delete its image?**

No — orphaned objects are an accepted, documented trade-off rather than a bug.
Keeping deletion non-transactional across two stores avoids a failure mode where
a half-failed delete leaves a row pointing at nothing. A periodic reconciliation
sweep would be the clean answer; it isn't built.

**Q: What if MinIO or Postgres is down mid-detection?**

Snapshot and DB failures inside the detection loop are logged and **swallowed**,
not raised — losing one evidence image must never kill a live camera pipeline
that is still protecting people. There are health endpoints (`/health/db`,
`/health/storage`, `/health/smtp`, `/health/streams`) so the failure is visible
rather than silent.

**Q: Why is each incident's zone stored on the row instead of resolved from the camera?**

Because resolving at read time produced retroactive history rewrites. Zone used
to be derived by following `camera_id → cameras.home_zone_id`. Since `camera_id`
is `ON DELETE SET NULL`, deleting a camera dumped its entire recorded history into
"Unassigned"; and reassigning a camera's home zone silently rewrote the zone of
every incident that predated the move. An `area_zone_id` column is now frozen onto
each row at write time, with a fallback to the camera's current home zone for
older rows. For a safety audit trail, history must not change under you.

**Q: You mention three different things called "zone". Untangle them.**

Fair — this is the easiest thing in the system to confuse:

1. **`PhysicalZone` / AREA zone** — a coarse named factory area ("Production",
   "Warehouse"). Not drawn on video. Used for analytics grouping and as a camera's
   "home zone". This is what `area_zone_id` points at.
2. **Drawn zone** (`CameraZoneView` over a `PhysicalZone`) — the actual polygon on
   a specific camera's image: RESTRICTED / WALKWAY / SLIPPERY / IGNORE. This is
   what detection tests against and what `zone_violations.physical_zone_id` points
   at.
3. **3D blueprint `ZoneId`** (`Z01`/`Z02`/`Z03`) — a purely visual mapping used by
   the 3D factory view. No detection meaning. (The input field for it was just
   removed from the camera config panel in the latest commit.)

**Q: How do you avoid duplicate camera rows for one physical camera?**

`camera_identity.normalize_camera_source_key` canonicalizes `localhost` and `::1`
to `127.0.0.1` (preserving port and userinfo) before any lookup or create, so
`rtsp://localhost:8554/stream2` and `rtsp://127.0.0.1:8554/stream2` resolve to one
`Camera` row. A recent fix caught the one path that had skipped normalization —
zone saving matched on the raw name, minting a duplicate camera for one physical
stream.

**Q: How do you manage schema changes without Alembic?**

Honestly: there is no migration framework. `SQLModel.metadata.create_all()`
creates whole missing tables and never alters an existing one, so schema changes
ship as **idempotent, re-runnable patch scripts** under `backend/scripts/` —
`add_incident_area_zone.py` (adds and backfills, including re-attaching rows
orphaned by a camera deletion), `backfill_zone_violation_severity.py`,
`add_report_language_column.py`, `apply_new_indexes.py`. A fresh database gets
everything from `create_all()`. Adopting Alembic is the right answer before this
runs in a real plant, and it's on the roadmap list below.

**Q: You said a whole class of incident was invisible for a while. What happened?**

`zone_violations.severity` was nullable and **nothing on the write path ever set
it**, so every incursion ever recorded stored `NULL`. The read layer coerced
`NULL` to "Medium" — and the dashboard's "Open Incidents" figure counts
Critical + High. So a restricted-zone incursion was detected, stored, snapshotted,
and then never appeared in the one number an operator actually watches. The write
path now derives severity, and a backfill script fixed history so old and new
rows agree.

---

## 9. Analytics & reporting

**Q: What does the analytics layer give a safety manager?**

Over a 24H / 7D / 30D range: total incidents, per-zone breakdown, severity and
type distributions, "active" zones (anything in the last 15 minutes), open
incidents (Critical + High), camera counts, an hourly-or-daily trend line, and a
week-over-week / month-over-month comparison. Plus a live incident feed and a
hand-built radial "Zone Pulse" diagram where node size tracks incident volume.

**Q: Why aggregate in Python instead of SQL? That sounds slow.**

Deliberate trade-off. The three incident tables are shaped differently and
severity is derived differently for each — PPE severity is inferred from text and
never stored, zone severity is a defaulted free-text column, behavior severity is
stored uppercase with a different default. Expressing all that in SQL `CASE`
expressions would re-create the exact drift risk that a single shared
normalization module exists to prevent. Memory is bounded by
`ANALYTICS_LIMIT = 20000` rows per category, and whenever a cap is hit the
response logs a warning and the PDF surfaces a data caveat, rather than quietly
showing a truncated truth.

Note the one place where SQL *was* required: server-side pagination of the merged
feed. `GET /safety-events` does a `UNION ALL` over a `(category, id, timestamp)`
projection with `ORDER BY`/`LIMIT`/`OFFSET` applied to the union, then hydrates
only that page — because filtering and paging must happen *before* `LIMIT`, not
after. `id DESC` is part of the sort key so a same-timestamp burst has a stable
order instead of rows appearing on two pages or none.

**Q: Your analytics handlers are sync `def`, not `async def`. Isn't that wrong for FastAPI?**

It's the opposite — and it's a measured fix. `AnalyticsService` does synchronous
SQLAlchemy work and Python aggregation. Declared `async def`, that ran directly on
the asyncio event loop and blocked the entire server: one `/analytics/summary`
call pushed `/health` from a 4ms median to **1549ms**, and every camera WebSocket
stalled with it. FastAPI runs plain `def` handlers in a threadpool instead. The
code carries a "do not 'fix' these back to `async def`" comment.

Related: `app/db/session.py` now passes `connect_timeout=5`, because libpq blocks
in `connect()` indefinitely by default — and with DB endpoints on the event loop
that block froze the whole server including running camera WebSockets. Failing
fast turns an unrecoverable hang into a 503.

**Q: Why are there two different camera counts in the UI?**

Because they answer different questions and were being conflated.
`active_cameras` is historical: cameras that recorded an incident inside the
requested range — that's what the PDF's coverage narrative needs. `live_cameras`
is point-in-time: cameras whose source is being streamed right now, independent of
range — that's what the dashboard KPI shows.

**Q: Are the "Key Insights" in the PDF generated by an LLM?**

No — they're deterministic rule-based generators (`reporting/insights.py`): trend
direction, hotspot zone (>=30% share), dominant incident type (>=25%),
critical-severity flag, severity shifts, peak activity day, zero-incident zones,
camera coverage gaps, and an explicit "all clear" when there's nothing. For a
safety report that gets emailed to management, reproducibility and auditability
beat fluency: the same data always produces the same sentence, and there is
nothing that can hallucinate a number. `build_caveats()` separately flags data
quality problems — analytics cap hit, no cameras registered, zone-filtered scope,
UTC timezone fallback.

**Q: The report is bilingual. How is that implemented?**

Four layers, not one string table, because Vietnamese needs real word order:

1. **`reporting/i18n.py`** — static `t(key, language)` table for chrome: section
   headings, table headers, KPI labels, empty states.
2. **`insights.py`** — each generator composes its *own* sentence per language,
   because these interpolate numbers and names.
3. **`pdf_renderer.py` / `report_data.py`** — small local maps for single words
   reused across table cells, chart legends and canvas-drawn text (severity:
   Nghiêm Trọng / Cao / Trung Bình / Thấp).
4. **`email_sender.py`** — subject templates keyed by language, HTML body labels
   as placeholders. Same markup both languages: a template swap, not a rewrite.

Deliberately **not** translated: incident type labels, zone names and camera names
— they're user-configured data. An unknown key or language falls back to English
rather than raising, so a missing translation degrades instead of crashing PDF
generation.

**Q: How does scheduled emailing work?**

An in-process APScheduler ticks every 15 minutes and calls
`check_and_send_scheduled_report()`, which reads a **singleton** schedule row
(`ReportSchedule`, id=1 — there's no auth or multi-tenancy, so one site-wide
schedule is intentional). Date math is pure and unit-tested: weekly uses
`day_of_week`, monthly clamps `day_of_month` to 1-28 so "day 31" never skips
February. Coarse 15-minute granularity is fine because the date math finds the
correct scheduled slot regardless of tick alignment. On failure `last_sent_at` is
**not** stamped, so the next tick retries instead of waiting a whole period. Every
send — success or failure — writes an append-only `report_deliveries` audit row.

**Q: Why is email off by default?** — **SECURITY**

Because `POST /reports/incidents/email` has **no authentication** — the whole app
has none. `REPORT_EMAIL_ENABLED` defaults to `false` specifically to guard it, and
`REPORT_RECIPIENT_ALLOWLIST` should be set non-empty before enabling it anywhere
reachable outside a trusted network, since an unauthenticated endpoint with a free
recipient field is a spam relay. There are also a recipient cap, an email-shape
regex, a header-injection guard, and an in-process rate limiter (20/hour). Note
the limiter and the scheduler are both single-process assumptions — multi-worker
uvicorn would multiply both. Also: `SMTPAuthenticationError` text is never logged
raw, because some servers echo credentials back in it.

---

## 10. Performance & scalability

**Q: How many cameras can this handle?**

`MAX_CONCURRENT_STREAMS = 8` on the current hardware — and be precise about what
that number is: it's a **safety ceiling**, not a reservation. It started at 1,
went to 3 when the Matrix View needed a camera set, and reached 8 once the model
pool was changed to grow on demand. `MODEL_POOL_PREWARM = 3` instances are built
and warmed at startup; the rest load when actually needed.

**Q: Why a pool of model instances at all? Why not share one?**

Because Ultralytics' `track(persist=True)` keeps tracker state on the model /
predictor object. Two cameras sharing one instance would cross-contaminate each
other's track IDs. So each concurrent stream borrows an instance
(`acquire_model_instance()`, 30s timeout) and returns it. Previously the pool was
sized entirely at startup, which made `MAX_CONCURRENT_STREAMS` a number you had
to hand-raise for every camera: too low and an extra camera's stream silently
retried forever behind a busy pool; high enough for future cameras and every
unused slot cost VRAM at boot. Now the ceiling (`_pool_size`) is tracked
separately from what actually exists (`_pool_created`).

**Q: What's the biggest optimization you made?**

**TensorRT.** PPE, pose and sign all run as FP16 TensorRT engines
(`weights/*.engine`) exported by `scripts/export_tensorrt.py` — roughly **3x
faster than the `.pt` checkpoints with the same detections**. Three subtleties are
worth mentioning because they're the kind of thing that fails silently:

- A TensorRT engine has no checkpoint to read its task from, and Ultralytics
  **guesses from the filename** — so `pose.engine` loaded as a *detect* model and
  silently dropped every keypoint. The task is now passed explicitly
  (`task="pose"` for the fall model, `task="detect"` for PPE, including pool
  instances).
- Engines are built for a fixed batch range, so the behavior scheduler's practice
  of padding batches to keep cuDNN on one input shape became pure waste — it
  pushed the last frame through preprocess/infer/postprocess for nothing: 20ms
  instead of 9ms with one camera. Padding is skipped for engines.
- Engines are GPU/driver/TensorRT-specific and must be rebuilt after changing any
  of those; the `.pt` paths remain the documented fallback. (Ultralytics' own
  export also sets a `BuilderFlag.FP16` that TensorRT 11 removed, which is why the
  project has its own export script with an explicitly-typed engine and a profile
  tuned for 384x640, capped at 640x640.)

**Q: What other optimizations?**

- **Batched pose inference**: `BehaviorInferenceScheduler` micro-batches ready
  frames from *every* camera through one CUDA pose call (max batch 4) instead of
  one model per stream.
- **ReID throttling**: re-encode every 4th frame per camera rather than every frame.
- **GMC disabled**: `BEHAVIOR_FIXED_CAMERA = true` forces
  `BEHAVIOR_GMC_METHOD = none` — global motion compensation is pointless work for
  a bolted-down factory camera.
- **Don't encode what nobody's watching**: a `viewing` flag gates preview JPEG
  production, so an enabled-but-unwatched camera still runs detection and records
  incidents without paying the encode/send cost.
- **MinIO bucket check** was running once *per object* instead of once per process.
- **Thread-pool containment**: `configure_inference_runtime()` runs before any
  router import so torch/cv2/OMP don't each spin up a full-machine thread pool.

**Q: How do you know any of this? Do you measure?**

`GET /health/streams` returns a per-camera health snapshot: capture cadence,
PPE/behavior/sign processed/dropped/gap counts, preview
generated/sent/coalesced, HLS rebuffer and dropped-frame counts, annotated
publisher composed/published/dropped/deadline-misses/encoder-restarts/queue-depth,
and named per-stage latency timings over a 60s rolling window with
last/mean/p50/p95/p99/max. `DELETE /health/streams` resets counters for controlled
benchmarking, and there are repeatable benchmark scripts
(`benchmark_llhls.py`, `benchmark_streams.py`) plus isolation probes
(`probe_stream_timing.py` for the source, `probe_ws_timing.py` for the backend).

That instrumentation is what let the team prove a ~746ms periodic delivery gap
reproduced in a standalone two-camera OpenCV capture — i.e. it was the source, not
FastAPI — and that narrowing the GPU critical section removed avoidable PPE
blocking.

**Q: What's the bottleneck, and what would you do with more hardware?**

GPU, specifically the per-frame pose model — it's the only consumer that can't be
throttled, since the classifier needs an unbroken 24 FPS timeline. More VRAM
raises the concurrent-camera ceiling directly (the pool grows on demand). The next
structural step would be splitting inference out of the FastAPI process into a
dedicated worker service, which would also remove today's single-process
assumptions.

---

## 11. Security, privacy & ethics

**Q: Is there authentication?** — **WEAK SPOT: answer this before you're asked**

No. There is no auth, no user model, no multi-tenancy — it's an internal-network
tool at this stage, and that is the honest framing. The consequences are known
and documented rather than discovered: the email endpoint is guarded by an
off-by-default flag plus a recipient allowlist precisely because it's otherwise
reachable by anyone who can reach the backend; `DELETE /violations` wipes all
three incident tables in one call; CORS is restricted to `localhost:3000`. Before
any deployment reachable beyond a trusted network, auth is the first thing to
build. `backend/docs/internal_deployment.md` covers the hardening list.

**Q: What personal data do you store?**

No biometric identifiers, no faces stored as identity, no names, no per-worker
records. What's stored is: a timestamp, a camera, a zone, a violation type, a
bounding box, a per-session tracker ID, and a JPEG snapshot of the moment. The
snapshot obviously contains an image of a person, which makes it personal data
under GDPR-style regimes — so retention policy, signage/notice at camera
locations, and access control are genuine compliance obligations, not technical
details. Currently there is **no automatic retention/purge job**; evidence
accumulates until deleted. Say that plainly if asked.

**Q: Could this be repurposed to track individuals?**

Architecturally it's poorly suited to it, and that's intentional: tracker IDs are
per-session and don't survive a reconnect, the ReID model is used only for
short-occlusion continuity within one stream, and there is no identity store to
join against. The reporting layer aggregates by zone rather than by person. That
said — a ReID model plus stored snapshots is the raw material, so the real
protection is policy and access control, which is another reason auth sits at the
top of the roadmap.

**Q: The dashboard has an "AI-generated footage" badge. Why?**

Because the operator is watching a stream that has been machine-annotated, and
the interface should never let a composited frame be mistaken for a raw camera
feed — an inference artifact should not become someone's memory of what happened
on the floor. It's the same principle as `/stream-snapshot` returning **404 past
`ANNOTATED_SNAPSHOT_MAX_AGE_SECONDS = 10`** rather than serving a stale frame: no
surface should present old footage as the current view of the floor.

**Q: What are the ethical limits of deploying this?**

The honest position: this system is well-suited to answering "where and when do
safety problems cluster" and poorly suited to "who should be disciplined". It
cannot tell you *why* someone wasn't wearing a helmet — whether stock ran out,
a supervisor waved them through, or they chose not to. Using per-person counts as
a performance metric would also create a direct incentive to avoid cameras, which
makes the factory less safe, not more. Zone-level aggregation is the intended use,
and the absence of per-worker identity is a feature.

---

## 12. Deployment & operations

**Q: How is it deployed today?**

Local/on-prem development stack: Docker Compose runs PostgreSQL 16, MinIO and
MediaMTX; the FastAPI backend and Next.js frontend run natively (the backend
needs direct GPU access). Startup order matters: infrastructure → MediaMTX +
FFmpeg publisher → backend → frontend. For the demo, `scripts/publish-rtsp.ps1`
loop-publishes a video file as an RTSP stream to simulate a factory camera,
normalized to CFR 24 FPS / H.264 / 1s GOP / no B-frames so LL-HLS emits
one-second independently-decodable segments and the behavior pipeline gets its
trained cadence.

**Q: Why MediaMTX in the middle?**

It decouples the producer from the consumers and gives protocol translation for
free: cameras (or FFmpeg) publish RTSP, browsers can't play RTSP, and MediaMTX
serves it as LL-HLS (1s segments, 200ms parts) which `hls.js` plays natively. It's
also how the annotated republished stream reaches the browser at all. WebRTC,
RTMP and SRT are disabled — unused surface.

**Q: Why does the backend run natively instead of in a container?**

GPU passthrough plus a TensorRT engine that is specific to this GPU, driver and
TensorRT version. Containerizing it properly (CUDA base image, `--gpus`, engines
rebuilt inside the image) is on the roadmap; running it natively kept the
inference stack debuggable while it was still changing weekly. Also worth knowing:
the uvicorn reload watcher is restricted to `--reload-dir app`, because otherwise
every violation snapshot written under `backend/storage/` triggered a full server
restart and dropped every open camera WebSocket.

**Q: What's the single-process assumption problem?**

Several things live in process memory: the APScheduler report tick, the email rate
limiter, the live-stream registry (`live_streams.py`), the model pool, and MinIO
bucket auto-provisioning. Running multiple uvicorn workers would multiply
scheduled sends and give each worker a partial view of which cameras are live. It
is explicitly unsupported by the current code. The fix is extracting the scheduler
into its own process and moving shared state to Postgres or Redis.

**Q: How would you productionize this?**

Ordered by what I'd do first:

1. Authentication + roles (operator / safety manager / admin).
2. Alembic migrations replacing the patch-script pattern.
3. Split inference into a dedicated worker service; make the API stateless and
   multi-worker safe.
4. Evidence retention/purge policy with automatic enforcement.
5. Containerize the backend with GPU passthrough; real secret management (SMTP
   credentials and MinIO keys are in `.env` today).
6. TLS, RTSP credentials kept out of source keys, external monitoring on
   `/health/streams`.

**Q: What's the test story?**

`pytest` suites across repositories, routers, services (including the full
reporting package), and storage, plus focused unit/integration tests for the
things that historically broke: annotated-stream rendering, auto-zone, behavior
inference and runtime config, frame hub, inference device selection, model
cadence, PPE role logic, spatial geometry, stream health, streaming timeline
contracts, tracking overlay rendering, IGNORE-zone filtering, and the GPU
priority-lock deadlock regression. Two notable invariant tests: the severity SQL
predicate is asserted to select exactly the rows the Python normalizer labels with
that severity, and the PDF renderer is pure (no I/O — the caller pre-fetches
snapshot bytes) so it's fully unit-testable without DB or MinIO.

Weak spot if pushed: there's no CI pipeline, no coverage gate, and no
end-to-end/browser test. Model evaluation isn't part of the test suite either.

**Q: Why does the severity rule exist in three places? That sounds like a smell.**

It is a managed one. Severity now has three encodings: the Python read-layer
normalizer, the same rule as SQL (needed so filtering happens before
`LIMIT`/`OFFSET` in the paginated feed), and a client-side mirror for the filter
chips and incident cards. Because divergence would be invisible and wrong rather
than loud, there's a test asserting that for every stored row the SQL predicate
selects exactly the rows the Python normalizer labels with that severity — and the
docs say "change one, change all three". One useful detail: PPE violations are
**never** Critical by design, so a Critical row always means zone or behavior.

---

## 13. Limitations & roadmap

**Q: What doesn't work yet?** — know these before someone finds them

- **No authentication anywhere.**
- **No committed model evaluation metrics.**
- Two KPI tiles — **"PPE Compliance" and "People On Shift" — render `"—"`**;
  the data isn't wired. They're placeholders, not bugs. (Note the deliberate
  principle behind them: the KPI row shows a dash rather than inventing a number.)
- **`FAINT_DETECTED` / `COLLAPSE_DETECTED`** are schema-only; the classifier has 3
  classes.
- **Auto-zone suggestions can't distinguish "accepted" from "dismissed"** at the
  registry level — `accept()` only sets a generic `emitted` flag, so the `ACCEPTED`
  state is defined but never assigned.
- **No evidence retention/purge job**; deleting an incident leaves its MinIO
  object orphaned.
- **Single-process only** (scheduler, rate limiter, live-stream registry).
- **No migration framework** — idempotent patch scripts instead.
- **`backend/docs/api_routes.md` and `database_schema.dbml` are stale** relative to
  the code; `docs/CODEBASE_OVERVIEW.md` + `docs/CHANGES_SINCE_OVERVIEW.md` are the
  current truth.
- Latent dead code: `PPEDetector.predict()` calls a nonexistent `_real_predict`,
  unexercised because production paths route through `video_pipeline`.
- A per-camera reload-survival ("session grace") feature was prototyped and fully
  reverted; a reload still tears down and restarts that camera's pipeline via the
  lock/supersede lifecycle (the frame-hub and publisher grace windows are what
  make that fast).

**Q: What's next?**

Near term: model evaluation on held-out factory footage with published metrics;
auth; wiring the two placeholder KPIs; a retention policy. Medium: feeding the
"false positive" review labels back into retraining; more behavior classes now
that the schema and pipeline support them; multi-process deployment. Longer:
per-zone PPE rules (different areas requiring different equipment), and
integration with whatever incident or maintenance system the plant already uses.

---

## 14. Numbers cheat sheet

Have these on the tip of your tongue.

| Thing | Value | Why that value |
|---|---|---|
| PPE confidence threshold | 0.5 | `.env` override of the 0.3 default |
| PPE→person overlap | 0.3 | equipment assigned to best-overlapping person |
| PPE inference rate | 8 FPS | compliance changes slowly; saves GPU for pose |
| PPE confirmation | 0.75 s consecutive | ~6 samples at 8 FPS |
| New-track grace | 0.5 s | no verdict on a just-appeared person |
| Compliant-memory debounce | 1.5 s | suppresses flicker |
| Min person height | 10% of frame | too small to judge |
| Frame-edge margin | 5% | partially-visible people aren't judged |
| Behavior window | 60 frames = 2.5 s @ 24 FPS | must contain a whole fall |
| Behavior stride | 12 samples (0.5 s) | re-prediction cadence |
| Behavior confidence | 0.70 | raised from 0.50 |
| Behavior cooldown | 10 s per track | anti-spam |
| Min valid frame ratio | 0.70 | window data-quality gate |
| Pose gap repair | <= 8 samples | interpolated only if safe |
| Pose input size | 640 px | 47/121 → 112/121 frames on the fall clip |
| Live frame stride | **1** (validator-enforced) | classifier needs every frame |
| Behavior batch / burst | 4 / 2 | one CUDA pose call across cameras |
| ReID interval | every 4 frames | embeddings are expensive |
| Annotated stream delay | 3.0 s | 2 s was too short for the first window |
| PPE label TTL (compositor) | 8 frames | bounded staleness |
| Sign TTL (compositor) | 3 s | bounded staleness |
| Ordered queue | 180 frames | ~475 MiB raw BGR per camera at 720p |
| Frame-hub / publisher grace | 60 s each | 8 s still lost a slow reload |
| Snapshot max age | 10 s | past it, `/stream-snapshot` 404s |
| Max concurrent streams | 8 | safety ceiling, not a reservation |
| Model pool prewarm | 3 | rest load on demand |
| GPU lock priorities | behavior 0, PPE 1, sign 2 | budgets 40 ms / 500 ms |
| Sign confidence | 0.35 | |
| Sign rate / phase | 1 FPS, phase frame 13 | never competes with PPE for a frame |
| Sign stationary requirement | 3.0 s | a carried sign never confirms |
| Sign class map | 2→RESTRICTED, 3→SLIPPERY; {0,1}→PPE | |
| Analytics row cap | 20 000 per category | bounds Python aggregation |
| Report scheduler tick | 15 min | date math finds the right slot anyway |
| Report limits | 25 incident rows, 6 snapshots | |
| Timezone | Asia/Ho_Chi_Minh display, UTC storage | |
| TensorRT speedup | ~3x vs `.pt`, FP16 | same detections |
| Severity levels | Critical / High / Medium / Low | PPE is **never** Critical by design |
| Ports | MediaMTX 8554/8888, Postgres 5433, MinIO 9000/9011, API 8000, UI 3000 | |

---

## 15. Hostile / hard questions

**Q: Why build this instead of buying an off-the-shelf PPE detection product?**

Three concrete reasons, not a general "custom is better": (1) the zone logic is
De Heus-specific — inverted walkway semantics, janitor exemptions on slippery
floors, and exclusion masks for this plant's phantom-detection surfaces; (2) the
auto-zone-from-signage feature means the system configures itself from the
factory's existing safety signage rather than requiring a paid integration visit
per camera; (3) evidence stays on-premise, with no footage leaving the site and no
per-camera subscription. A COTS product would also not give you the annotated
single-clock stream, which is what makes the operator view trustworthy.

**Q: Isn't this just YOLO with a dashboard?**

The detector is the commodity part — and deliberately so. The engineering is
everything that turns detections into decisions someone can act on: the
confirmation and judgeability state machine, the dedup layer, the shared frame hub
with two subscription policies, the priority GPU lock with anti-starvation, the
server-side compositor that puts pixels and geometry on one clock, the
discontinuity/epoch handling that prevents classifying sequences that never
happened, and the evidence/audit trail. A raw YOLO dashboard fires on every frame
and gets ignored within a week.

**Q: Three seconds behind, 8 FPS PPE, no auth, no accuracy numbers. Is this actually production-ready?**

No, and I'd rather say so precisely than hedge. It's a working end-to-end system
with production-grade reliability engineering in the streaming and detection
paths, and a clear, short list of what's missing before a plant deployment: auth,
published model metrics, migrations, retention policy, and multi-process
deployment. The latency and the PPE cadence aren't on that list — they're
deliberate trade-offs for a supervisory system, and I can show the measurements
behind both.

**Q: What was the hardest bug you fixed?**

The GPU priority-lock deadlock (§6). It was a genuine liveness bug rather than a
logic error: whether a waiter was "next" depended on the wall clock as well as on
state, so a waiter could become the designated one with no state change — and
therefore no notification — and sleep through its turn forever on an *idle* lock.
Every GPU consumer parked at once while the annotated stream kept cheerfully
publishing frames with nothing drawn on them, which is the worst possible failure
mode for a safety display: it looks like a working camera with no violations. The
fix was making waiters time-bounded (park with a timeout from the nearest
deadline, capped at 50 ms, never 0) and notifying on join, so a missed wake costs
one tick.

**Q: Give me an example of a bug that was a design problem, not a coding error.**

The "Behavior detection unavailable" banner (§7). Nothing about it crashed; it
reported a real number. The mistake was showing a *startup projection* measured
before pose-gap repair as a user-facing verdict about current capability — so the
banner contradicted the falls visible on the same screen. The fix was a
judgement about what an interface owes its user: reserve the alarm for hard
failures, because a warning that cries wolf discredits the next one.

**Q: If you started over, what would you do differently?**

Two things. First, decide the overlay architecture up front — the browser-side box
layer synced by wall clock was built, debugged and eventually replaced wholesale
by the server-side compositor, and the three-independent-clocks problem was
predictable. Second, treat schema evolution as a day-one concern: adopting Alembic
before the first deployed database would have been much cheaper than the
patch-script-plus-backfill pattern the project has now.

**Q: How do you know the system is working right now, in production?**

`GET /health` for liveness, `/health/db`, `/health/storage`, `/health/smtp` for
dependencies, and `/health/streams` for the per-camera picture that actually
matters — capture cadence, per-model processed/dropped/gap counts, queue depths,
annotated-publisher deadline misses and encoder restarts, and p50/p95/p99 stage
latencies over a 60s window. Credentials are stripped from stream labels so the
endpoint is safe to expose to monitoring. Plus the frontend reports its own
playback metrics (live delay, rebuffers, dropped frames, overlay skew) *back* to
the backend, so the system knows how stale the operator's actual rendered view
is — not just how fast inference was.

---

## 16. Demo safety net

Things that can go wrong live, and what to say:

- **The annotated stream 404s for a few seconds at first.** Expected and
  documented: the playlist doesn't exist until the camera WebSocket has started
  its compositor. Say "the compositor is spinning up" and wait — don't reload in
  a panic.
- **Black or frozen feed.** Check in order: is the FFmpeg publisher terminal still
  running and looping; is MediaMTX up (`docker compose ps`); is the backend
  holding the lock from a previous socket (a superseded socket closes with 4001 —
  wait a moment rather than opening a third tab).
- **Nothing happens on the feed.** Confirm per-camera feature toggles are on for
  *that* camera — they're per-camera overrides, not global.
- **No behavior verdicts yet.** Every track needs 2.5s of unbroken tracking before
  a first verdict, so people are labelled "Behavior: Unknown" until then. This is
  correct behavior — and it's a good moment to explain the Unknown-vs-Compliant
  distinction rather than apologize for it.
- **Don't demo the email send** unless SMTP is verified beforehand (`GET
  /health/smtp`) — and remember it needs a 16-character Gmail App Password, not an
  account password.
- **Don't demo `DELETE /violations`.** It wipes all three incident tables.
- **Have a fallback recording.** If the GPU, MediaMTX or the network misbehaves, a
  pre-recorded screen capture of a working run keeps the presentation on the
  content instead of on the infrastructure.

### Things to have open before you start

- Dashboard: `http://localhost:3000`
- Swagger (proves the API surface fast): `http://localhost:8000/docs`
- Stream health (proves you measure): `http://localhost:8000/health/streams`
- A generated PDF report, already downloaded, in case emailing misbehaves
